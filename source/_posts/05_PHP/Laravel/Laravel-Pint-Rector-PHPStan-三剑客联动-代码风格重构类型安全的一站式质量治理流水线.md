---
title: Laravel Pint + Rector + PHPStan 三剑客联动：代码风格+重构+类型安全的一站式质量治理流水线
date: 2026-06-03 00:00:00
tags: [Laravel, Pint, Rector, PHPStan, 代码质量, CI/CD]
categories: [Laravel/PHP]
description: "深入讲解 Laravel Pint、Rector、PHPStan 三剑客联动的代码质量治理方案，涵盖代码风格统一、自动重构与静态分析的完整 CI/CD 流水线配置，含对比选型、踩坑案例与遗留项目渐进式接入策略。"
cover: /images/covers/laravel-pint-rector-phpstan-cover.jpg
---

# Laravel Pint + Rector + PHPStan 三剑客联动：代码风格+重构+类型安全的一站式质量治理流水线

## 前言：为什么需要代码质量治理流水线？

在任何一个成熟的 Laravel 项目中，随着业务迭代和团队扩张，代码库不可避免地会面临三大挑战：**代码风格不统一**、**历史技术债务堆积**、**类型安全隐患频发**。这三个问题看似独立，实则环环相扣——风格不一致导致 Code Review 效率低下，缺乏自动重构能力让技术债务越积越深，而类型安全的缺失则是线上事故的温床。

长期以来，PHP 社区在代码质量治理方面的工具链是碎片化的。开发者需要分别配置 PHP-CS-Fixer、Phan 或 Psalm、以及各种手动重构脚本，工具之间缺乏协调，执行顺序和优先级也需要自行管理。直到 Laravel Pint、Rector 和 PHPStan 这"三剑客"逐渐成熟，我们终于拥有了一套现代化的、可以紧密联动的质量治理方案。

本文将从实战角度出发，深入讲解如何将 Laravel Pint（代码风格）、Rector（自动重构）和 PHPStan（静态分析）三者有机联动，构建一条从本地开发到 CI/CD 的一站式质量治理流水线。无论你是刚入门 Laravel 的新手，还是管理大型项目的技术负责人，都能从中找到可落地的实践方案。

在正式开始之前，我们先来明确一个观点：**代码质量不是一次性投入，而是持续迭代的过程**。很多团队在引入代码质量工具时，往往犯一个错误——试图在一天之内让所有代码都达到最高标准。这种做法通常会导致两个结果：要么因为工作量过大而放弃，要么因为改动过多而引入新的 Bug。本文倡导的渐进式治理策略，正是为了避免这两个极端。

另外需要说明的是，本文中的所有配置和代码示例都是基于 2026 年初的最新版本。Pint、Rector 和 PHPStan 都在快速迭代中，具体版本号和 API 可能会随时间变化，但核心理念和最佳实践是长期适用的。

---

## 第一章：Laravel Pint——不只是 PHP-CS-Fixer 的包装

### 1.1 Pint 是什么？为什么选择它？

Laravel Pint 是 Taylor Otwell 在 2022 年推出的代码风格工具，本质上是对 PHP-CS-Fixer 的一层精简封装。但这个"封装"绝非简单的套壳，它做了几件非常有价值的事情：

- **零配置即可使用**：安装后直接运行 `./vendor/bin/pint`，默认采用 Laravel 风格规则集
- **内置 Laravel 风格预设**：不需要像 PHP-CS-Fixer 那样手动配置几十条规则
- **与 Laravel 生态深度集成**：遵循 Laravel 社区的编码规范，减少团队内部的风格争论
- **性能优化**：在处理大型项目时，Pint 的执行速度经过优化

安装非常简单：

```bash
composer require laravel/pint --dev
```

首次运行时，Pint 会自动创建 `pint.json` 配置文件：

```bash
./vendor/bin/pint
```

### 1.2 Pint 配置详解与自定义规则

Pint 的配置文件 `pint.json` 位于项目根目录，支持三种预设：

- **laravel**（默认）：Laravel 官方编码规范
- **psr12**：PSR-12 标准
- **symfony**：Symfony 编码规范

一个基础的配置文件如下：

```json
{
    "preset": "laravel",
    "rules": {
        "simplified_null_return": true,
        "array_syntax": {
            "syntax": "short"
        },
        "ordered_imports": {
            "sort_algorithm": "alpha"
        },
        "no_unused_imports": true,
        "single_quote": true,
        "trailing_comma_in_multiline": true,
        "declare_strict_types": true
    }
}
```

#### 1.2.1 常用规则分类说明

**代码结构类规则：**

```json
{
    "rules": {
        "no_unused_imports": true,
        "ordered_imports": {
            "sort_algorithm": "alpha",
            "imports_order": ["class", "function", "const"]
        },
        "no_empty_statement": true,
        "no_extra_blank_lines": {
            "tokens": ["extra", "throw", "use", "return"]
        }
    }
}
```

**PHP 8.x 现代化规则：**

```json
{
    "rules": {
        "declare_strict_types": true,
        "void_return": true,
        "array_syntax": {"syntax": "short"},
        "list_syntax": {"syntax": "short"},
        "ternary_to_null_coalescing": true,
        "nullable_type_declaration_for_default_null_value": true,
        "no_phpstorm_constructor_comment": true
    }
}
```

**Laravel 特色规则：**

```json
{
    "rules": {
        "simplified_null_return": true,
        "phpdoc_separation": true,
        "phpdoc_order": true,
        "phpdoc_trim": true,
        "phpdoc_types_order": {"null_adjustment": "always_last"}
    }
}
```

#### 1.2.2 路径排除与特殊文件处理

在实际项目中，有些目录或文件需要排除在格式化之外：

```json
{
    "preset": "laravel",
    "exclude": [
        "vendor",
        "storage",
        "bootstrap/cache",
        "node_modules",
        "database/migrations"
    ],
    "notName": [
        "*.blade.php",
        "_ide_helper*.php",
        "_ide_helper_models.php"
    ],
    "rules": {
        "declare_strict_types": true
    }
}
```

#### 1.2.3 编写自定义 Pint 规则

当内置规则无法满足团队的特殊需求时，Pint 支持自定义规则。虽然 Pint 本身不直接支持编写自定义 Fixer，但我们可以通过以下方式扩展：

```json
{
    "preset": "laravel",
    "rules": {
        "declare_strict_types": true
    },
    "require": [
        "friendsofphp/php-cs-fixer"
    ]
}
```

更高级的场景是编写项目级的 Fixer 类。在项目中创建 `app/CodeStyle/CustomFixers/` 目录：

```php
<?php

declare(strict_types=1);

namespace App\CodeStyle\CustomFixers;

use PhpCsFixer\Fixer\FixerInterface;
use PhpCsFixer\FixerDefinition\FixerDefinition;
use PhpCsFixer\FixerDefinition\FixerDefinitionInterface;
use PhpCsFixer\Tokenizer\Tokens;
use SplFileInfo;

final class NoInlineArrayInMethodCallFixer implements FixerInterface
{
    public function getDefinition(): FixerDefinitionInterface
    {
        return new FixerDefinition(
            'Inline arrays in method calls should use multiline syntax.',
            []
        );
    }

    public function isCandidate(Tokens $tokens): bool
    {
        return $tokens->isAnyTokenKindsFound([T_STRING]);
    }

    public function isRisky(): bool
    {
        return false;
    }

    public function fix(SplFileInfo $file, Tokens $tokens): void
    {
        // 自定义格式化逻辑
    }

    public function getName(): string
    {
        return 'Laravel/NoInlineArrayInMethodCall';
    }

    public function getPriority(): int
    {
        return 0;
    }

    public function supports(SplFileInfo $file): bool
    {
        return true;
    }
}
```

然后在 `pint.json` 中引用自定义规则。

#### 1.2.4 Pint 的增量模式与缓存

对于大型项目，全量运行 Pint 可能较慢。我们可以利用 Git 的能力实现增量格式化：

```bash
# 只格式化已修改的文件
./vendor/bin/pint $(git diff --name-only --diff-filter=ACM -- '*.php')

# 只检查（不修改）已修改的文件
./vendor/bin/pint --test $(git diff --name-only --diff-filter=ACM -- '*.php')
```

也可以结合 Git pre-commit hook 实现提交前自动格式化：

```bash
#!/bin/bash
# .git/hooks/pre-commit

# 获取暂存区中的 PHP 文件
STAGED_PHP_FILES=$(git diff --cached --name-only --diff-filter=ACM -- '*.php')

if [ -z "$STAGED_PHP_FILES" ]; then
    exit 0
fi

# 运行 Pint
./vendor/bin/pint $STAGED_PHP_FILES

# 将格式化后的文件重新加入暂存区
echo "$STAGED_PHP_FILES" | xargs git add

exit 0
```

---

## 第二章：Rector——自动重构的瑞士军刀

### 2.1 Rector 的核心理念

Rector 是一个由 Tomas Votruba 主导的 PHP 自动重构工具。它的核心理念可以用一句话概括：**将手动的、重复的代码修改工作自动化**。Rector 不仅仅是代码迁移工具，它涵盖了几类关键场景：

1. **PHP 版本升级**：将旧版 PHP 语法自动转换为新版本
2. **框架版本升级**：自动化 Laravel、Symfony 等框架的 Breaking Change 适配
3. **代码质量改善**：自动应用最佳实践和设计模式
4. **Dead Code 清理**：识别并移除未使用的代码

安装 Rector：

```bash
composer require rector/rector --dev
```

初始化配置：

```bash
./vendor/bin/rector init
```

### 2.2 Rector 配置详解

一个完整的 `rector.php` 配置文件：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;
use Rector\Laravel\Set\LaravelLevelSetList;
use Rector\CodeQuality\Rector\Class_\InlineConstructorDefaultToPropertyRector;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
        __DIR__ . '/tests',
    ])
    ->withSkip([
        __DIR__ . '/vendor',
        __DIR__ . '/storage',
        __DIR__ . '/bootstrap/cache',
        // 某些自动生成的文件
        __DIR__ . '/database/migrations',
    ])
    ->withPhpSets(php83: true)
    ->withSets([
        SetList::CODE_QUALITY,
        SetList::DEAD_CODE,
        LaravelLevelSetList::LARAVEL_110,
    ]);
```

#### 2.2.1 PHP 版本升级规则集

Rector 提供了从 PHP 5.3 到 PHP 8.4 的完整升级路径：

```php
use Rector\Config\RectorConfig;

return RectorConfig::configure()
    // 指定当前 PHP 版本和目标版本
    ->withPhpSets(
        php74: true,  // 当前最低 PHP 版本
        php83: true   // 目标 PHP 版本
    );
```

常用的 PHP 版本升级规则包括：

- **PHP 7.4**：箭头函数 `fn() =>`、类型属性、空合并赋值 `??=`
- **PHP 8.0**：Union Types、`match` 表达式、命名参数、Nullsafe Operator
- **PHP 8.1**：枚举、只读属性、纤程、交集类型
- **PHP 8.2**：只读类、`true`/`false`/`null` 独立类型
- **PHP 8.3**：类型化类常量、`json_validate()`、深拷贝 `clone readonly`
- **PHP 8.4**：属性钩子、`new` 不带括号的实例化

一个实际的升级例子：

```php
// 升级前 (PHP 7.x 风格)
public function process($items): array
{
    $results = [];
    foreach ($items as $item) {
        $value = isset($item['status']) ? $item['status'] : 'unknown';
        $results[] = $value;
    }
    return $results;
}

// Rector 自动重构后 (PHP 8.x 风格)
public function process(array $items): array
{
    return array_map(
        static fn(array $item): string => $item['status'] ?? 'unknown',
        $items
    );
}
```

#### 2.2.2 Laravel 框架升级规则集

Rector 的 Laravel 扩展包是升级 Laravel 项目的利器：

```bash
composer require rector/rector-laravel --dev
```

配置 Laravel 升级：

```php
use Rector\Config\RectorConfig;
use Rector\Laravel\Set\LaravelLevelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/routes',
    ])
    ->withSets([
        // 从 Laravel 8 一路升级到 Laravel 11
        LaravelLevelSetList::LARAVEL_110,
    ]);
```

Rector 能处理的 Laravel 变更包括：

- **路由定义迁移**：从 `Route::resource()` 到 API Resource Controller 的规范化
- **模型变更**：`$dates` 到 `$casts` 的迁移、`SoftDeletes` 特性的更新
- **服务容器变更**：`app()` 辅助函数的类型推断、服务提供者的自动注册
- **中间件变更**：Kernel 类到 `bootstrap/app.php` 的迁移（Laravel 11）
- **配置项变更**：过时配置的自动更新

一个 Laravel 11 升级示例：

```php
// 升级前 (Laravel 8/9 风格)
class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected $dates = [
        'created_at',
        'updated_at',
        'deleted_at',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];
}

// Rector 重构后 (Laravel 11 风格)
class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'deleted_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }
}
```

#### 2.2.3 自定义 Rector 规则

Rector 最强大的地方在于你可以编写自定义规则。以下是一个示例，将项目中所有使用 `dd()` 的代码替换为 `logger()` + `throw`：

```php
<?php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Expr\FuncCall;
use PhpParser\Node\Name;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

final class ReplaceDdWithLoggerRector extends AbstractRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            'Replace dd() calls with logger() and proper exception',
            []
        );
    }

    public function getNodeTypes(): array
    {
        return [FuncCall::class];
    }

    public function refactor(Node $node): ?Node
    {
        if (! $this->isName($node, 'dd')) {
            return null;
        }

        // 转换为 logger()->debug() 调用
        $loggerFuncCall = $this->nodeFactory->createFuncCall('logger');
        $methodCall = $this->nodeFactory->createMethodCall($loggerFuncCall, 'debug', $node->args);

        return $methodCall;
    }
}
```

在 `rector.php` 中注册自定义规则：

```php
use App\Rector\ReplaceDdWithLoggerRector;

return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withRules([
        ReplaceDdWithLoggerRector::class,
    ]);
```

#### 2.2.4 Rector 的 dry-run 与渐进式重构

Rector 提供了安全的渐进式重构模式：

```bash
# 只检查，不做任何修改（适合 CI 环境）
./vendor/bin/rector process --dry-run

# 只处理特定目录
./vendor/bin/rector process app/Services

# 显示详细的变更说明
./vendor/bin/rector process --dry-run --debug

# 生成补丁文件而不是直接修改
./vendor/bin/rector process --output-format=json > rector-report.json
```

Rector 还支持通过 `rector.php` 中的配置来限制处理范围：

```php
return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withSkip([
        // 跳过特定规则在特定文件中的应用
        __DIR__ . '/app/Legacy',
    ])
    ->withRules([
        // 只应用少量关键规则
    ]);
```

---

## 第三章：PHPStan——静态分析的终极防线

### 3.1 PHPStan 为什么重要？

PHPStan 是 PHP 生态中最强的静态分析工具，由 Ondřej Mirtes 开发。它能在不运行代码的情况下发现潜在的 Bug、类型错误和逻辑问题。PHPStan 的核心价值在于：

- **类型安全**：在运行前捕获类型错误
- **Bug 预防**：发现空指针、未定义方法调用等常见 Bug
- **代码理解**：通过类型注解提升代码的可读性和可维护性
- **重构信心**：有了 PHPStan 的守护，大规模重构更加安全

安装 PHPStan 及 Laravel 扩展：

```bash
composer require phpstan/phpstan --dev
composer require larastan/larastan --dev
```

### 3.2 PHPStan 的 Level 体系

PHPStan 提供了 0-10 共 11 个分析级别，每个级别都比上一个更加严格：

| Level | 检查内容 | 难度 |
|-------|---------|------|
| 0 | 基本检查：函数调用参数数量、未定义变量、未知类 | 入门 |
| 1 | 可能未定义的变量、未知魔术方法/属性 | 简单 |
| 2 | 未知方法调用在所有代码路径上的验证 | 简单 |
| 3 | 返回类型验证、赋值类型检查 | 中等 |
| 4 | 基本死代码检查、始终 true/false 的条件 | 中等 |
| 5 | 参数类型检查、严格类型比较 | 较难 |
| 6 | 严格类型比较、`mixed` 类型限制 | 较难 |
| 7 | `mixed` 类型的进一步限制、`@throws` 注解 | 难 |
| 8 | `null` 安全检查的全面覆盖 | 困难 |
| 9 | 未知的 `array{key: Type}` 结构 | 困难 |
| 10 | 最高级别，极严格 | 极难 |

### 3.3 PHPStan 配置详解

一个完整的 `phpstan.neon` 配置文件：

```neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app

    # 分析级别
    level: 6

    # 忽略的错误
    ignoreErrors:
        - '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder::[a-zA-Z]+#'
        - '#Call to an undefined method Illuminate\\Database\\Query\\Builder::[a-zA-Z]+#'
        - '#Parameter \#1 \$callback of function array_map expects#'
        - '#Property [a-zA-Z]+::\$[a-zA-Z]+ is never read, only written#'

    # 排除路径
    excludePaths:
        - app/Console/Kernel.php
        - app/Http/Middleware/*
        - vendor/*

    # 自动加载文件
    bootstrapFiles:
        - app/Helpers/helpers.php

    # 检查未使用的忽略规则
    reportUnmatchedIgnoredErrors: true

    # 扩展 Laravel Eloquent Builder
    checkMissingIterableValueType: true
    checkGenericClassInSemiGenericTypes: true
```

#### 3.3.1 Level 提升策略

从 Level 0 开始，逐级提升是最重要的实践。以下是推荐的提升路径：

**阶段一：Level 0-3（基础稳固期）**

这是最快通过的阶段，主要解决基本的类型问题：

```bash
# 当前 Level
./vendor/bin/phpstan analyse --level=0

# 修复后升级
./vendor/bin/phpstan analyse --level=1
# ... 逐步提升到 level=3
```

在这个阶段，常见的修复工作包括：

```php
// 修复前：缺少类型注解
public function getUser($id)
{
    return User::find($id);
}

// 修复后：添加类型注解
public function getUser(int $id): ?User
{
    return User::find($id);
}
```

**阶段二：Level 4-6（进阶提升期）**

这个阶段需要更细致的类型注解：

```php
// 修复前：返回类型不精确
public function getActiveUsers(): Collection
{
    return User::where('is_active', true)->get();
}

// 修复后：使用泛型注解
/** @return Collection<int, User> */
public function getActiveUsers(): Collection
{
    return User::where('is_active', true)->get();
}
```

对于 Laravel 中常见的 Builder 链式调用，需要使用 PHPDoc 注解：

```php
/**
 * @param Builder<User> $query
 * @return Builder<User>
 */
public function scopeActive(Builder $query): Builder
{
    return $query->where('is_active', true);
}
```

**阶段三：Level 7-10（严格模式期）**

这是最困难的阶段，需要全面的类型覆盖：

```php
// Level 7+ 要求的严格类型处理
public function process(mixed $data): array
{
    // 必须检查 mixed 类型
    if (! is_array($data)) {
        throw new InvalidArgumentException('Expected array');
    }

    // 处理逻辑...
    return array_filter($data, static fn(mixed $item): bool => $item !== null);
}
```

#### 3.3.2 常见的 Laravel 特定问题与解决方案

**Eloquent 关系类型注解：**

```php
/**
 * @property-read int $id
 * @property-read string $name
 * @property-read string $email
 * @property-read \Illuminate\Support\Carbon|null $email_verified_at
 * @property-read Collection<int, Post> $posts
 * @property-read Collection<int, Role> $roles
 */
class User extends Authenticatable
{
    /** @return HasMany<Post> */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }

    /** @return BelongsToMany<Role> */
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }
}
```

**处理 Laravel Facade 的类型问题：**

```php
// Facade 有时会导致类型推断失败
// 解决方案：使用 @var 注解或改用依赖注入

// 方式一：使用注解
/** @var \Illuminate\Cache\Repository $cache */
$cache = Cache::store('redis');
$value = $cache->get('key');

// 方式二：使用依赖注入（推荐）
class UserService
{
    public function __construct(
        private readonly CacheManager $cache
    ) {}

    public function getCachedUser(int $id): ?User
    {
        return $this->cache->remember(
            "user:{$id}",
            3600,
            fn() => User::find($id)
        );
    }
}
```

**泛型集合的正确使用：**

```php
/**
 * @template T of Model
 */
class Repository
{
    /** @var Collection<int, T> */
    private Collection $items;

    /** @param Collection<int, T> $items */
    public function __construct(Collection $items)
    {
        $this->items = $items;
    }

    /** @return T|null */
    public function find(int $id): ?Model
    {
        return $this->items->first(
            static fn(Model $item): bool => $item->getKey() === $id
        );
    }

    /** @return Collection<int, T> */
    public function filter(callable $predicate): Collection
    {
        return $this->items->filter($predicate);
    }
}
```

#### 3.3.3 PHPStan 扩展与 Baseline

**使用 Baseline 忽略已有错误：**

对于大型遗留项目，一次性修复所有 PHPStan 错误是不现实的。Baseline 功能允许你冻结现有的错误，只检查新增代码：

```bash
# 生成 baseline 文件
./vendor/bin/phpstan analyse --generate-baseline

# 这会生成 phpstan-baseline.neon 文件
```

在 `phpstan.neon` 中引用 baseline：

```neon
includes:
    - phpstan-baseline.neon
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app
    level: 6
```

**常用 PHPStan 扩展：**

```bash
# Larastan - Laravel 专用扩展（必装）
composer require larastan/larastan --dev

# PHPStan Doctrine 扩展（如使用 Doctrine）
composer require phpstan/phpstan-doctrine --dev

# PHPStan PHPUnit 扩展
composer require phpstan/phpstan-phpunit --dev

# PHPStan Strict Rules（超级严格模式）
composer require phpstan/phpstan-strict-rules --dev
```

---

## 第四章：三剑客联动——构建质量治理流水线

### 4.1 为什么需要联动？

单独使用 Pint、Rector、PHPStan 都能带来价值，但三者联动后产生的效果是 1+1+1 > 3 的。原因在于：

1. **执行顺序至关重要**：Pint 格式化代码 → Rector 重构 → PHPStan 检查类型安全
2. **互相补盲**：Pint 处理风格，Rector 处理结构，PHPStan 处理逻辑，三者覆盖无死角
3. **CI 效率最大化**：统一的流水线比三个独立工具更易于管理和监控
4. **反馈闭环**：PHPStan 发现的问题可以通过 Rector 自动修复，Pint 确保修复后的风格一致

### 4.2 本地开发环境配置

#### 4.2.1 Composer 脚本集成

在 `composer.json` 中定义统一的脚本：

```json
{
    "scripts": {
        "pint": "./vendor/bin/pint",
        "pint:test": "./vendor/bin/pint --test",
        "rector": "./vendor/bin/rector process",
        "rector:dry": "./vendor/bin/rector process --dry-run",
        "phpstan": "./vendor/bin/phpstan analyse --memory-limit=2G",
        "quality": [
            "@pint",
            "@rector",
            "@phpstan"
        ],
        "quality:check": [
            "@pint:test",
            "@rector:dry",
            "@phpstan"
        ]
    }
}
```

使用方式：

```bash
# 运行完整质量治理（会自动修改代码）
composer quality

# 只检查，不修改（适合 CI）
composer quality:check

# 单独运行某个工具
composer pint
composer rector
composer phpstan
```

#### 4.2.2 Makefile 方案

对于更复杂的场景，使用 Makefile 可以提供更灵活的控制：

```makefile
.PHONY: quality quality-check pint rector phpstan

# 完整质量治理流水线
quality:
	@echo "🔧 Step 1: Formatting code with Pint..."
	@./vendor/bin/pint --quiet
	@echo "🔨 Step 2: Refactoring with Rector..."
	@./vendor/bin/rector process --no-ansi
	@echo "🔍 Step 3: Static analysis with PHPStan..."
	@./vendor/bin/phpstan analyse --memory-limit=2G --no-progress
	@echo "✅ Quality pipeline completed!"

# 只检查不修改
quality-check:
	@echo "🔍 Running quality checks..."
	@./vendor/bin/pint --test --quiet
	@./vendor/bin/rector process --dry-run --no-ansi
	@./vendor/bin/phpstan analyse --memory-limit=2G --no-progress
	@echo "✅ All checks passed!"

# 单独运行
pint:
	./vendor/bin/pint

rector:
	./vendor/bin/rector process

phpstan:
	./vendor/bin/phpstan analyse --memory-limit=2G

# Git hooks
install-hooks:
	@cp scripts/pre-commit .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "✅ Git hooks installed!"
```

#### 4.2.3 Pre-commit Hook 实现

创建一个智能的 pre-commit hook，只检查修改过的文件：

```bash
#!/bin/bash
# scripts/pre-commit

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取暂存区中的 PHP 文件
STAGED_PHP=$(git diff --cached --name-only --diff-filter=ACM -- '*.php' | grep -v vendor/)

if [ -z "$STAGED_PHP" ]; then
    echo -e "${GREEN}No PHP files staged. Skipping checks.${NC}"
    exit 0
fi

echo -e "${YELLOW}🔍 Running quality checks on staged files...${NC}"

# Step 1: Pint 格式化
echo -e "${YELLOW}Step 1: Running Pint...${NC}"
./vendor/bin/pint $STAGED_PHP
echo "$STAGED_PHP" | xargs git add

# Step 2: Rector 检查（仅 dry-run，避免 pre-commit 中自动重构）
echo -e "${YELLOW}Step 2: Running Rector (dry-run)...${NC}"
if ! ./vendor/bin/rector process $STAGED_PHP --dry-run --no-ansi; then
    echo -e "${RED}❌ Rector found issues. Please run 'composer rector' first.${NC}"
    exit 1
fi

# Step 3: PHPStan 分析修改过的文件
echo -e "${YELLOW}Step 3: Running PHPStan...${NC}"
if ! ./vendor/bin/phpstan analyse $STAGED_PHP --memory-limit=1G --no-progress --error-format=raw; then
    echo -e "${RED}❌ PHPStan found errors. Please fix them before committing.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All quality checks passed!${NC}"
exit 0
```

### 4.3 CI/CD 流水线配置

#### 4.3.1 GitHub Actions 配置

这是最推荐的 CI 方案，配置全面且易于维护：

```yaml
# .github/workflows/quality.yml
name: Code Quality Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  quality:
    name: Quality Checks
    runs-on: ubuntu-latest

    strategy:
      matrix:
        php-version: ['8.2', '8.3']

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php-version }}
          extensions: dom, curl, libxml, mbstring, zip, pcntl, pdo, sqlite, pdo_sqlite, bcmath, soap, intl, gd, exif, iconv, imagick
          coverage: none

      - name: Get Composer cache directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --optimize-autoloader

      - name: Check code style with Pint
        run: ./vendor/bin/pint --test

      - name: Check Rector changes
        run: ./vendor/bin/rector process --dry-run

      - name: Run PHPStan static analysis
        run: ./vendor/bin/phpstan analyse --memory-limit=2G --no-progress --error-format=github
```

#### 4.3.2 GitLab CI 配置

```yaml
# .gitlab-ci.yml
stages:
  - quality
  - test

variables:
  COMPOSER_CACHE_DIR: "$CI_PROJECT_DIR/.composer-cache"

cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - .composer-cache/
    - vendor/

.quality_template: &quality_definition
  stage: quality
  image: php:8.3-cli
  before_script:
    - apt-get update -qq && apt-get install -yqq git unzip libzip-dev
    - docker-php-ext-install zip
    - curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
    - composer install --no-interaction --prefer-dist --no-scripts

pint:
  <<: *quality_definition
  script:
    - ./vendor/bin/pint --test
  allow_failure: false

rector:
  <<: *quality_definition
  script:
    - ./vendor/bin/rector process --dry-run
  allow_failure: false

phpstan:
  <<: *quality_definition
  script:
    - ./vendor/bin/phpstan analyse --memory-limit=2G --no-progress
  allow_failure: false
```

#### 4.3.3 多环境并行策略

为了加速 CI 反馈，可以将三个工具拆分为并行的 Job：

```yaml
# .github/workflows/quality-parallel.yml
name: Quality Pipeline (Parallel)

on: [push, pull_request]

jobs:
  pint:
    name: Code Style (Pint)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-interaction --prefer-dist
      - run: ./vendor/bin/pint --test

  rector:
    name: Refactoring (Rector)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-interaction --prefer-dist
      - run: ./vendor/bin/rector process --dry-run

  phpstan:
    name: Static Analysis (PHPStan)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-interaction --prefer-dist
      - run: ./vendor/bin/phpstan analyse --memory-limit=2G
```

并行执行可以将 CI 时间从串行的 6-9 分钟缩短到 3-4 分钟（取决于最慢的那个工具）。

#### 4.3.4 CI 中的自动修复与通知

更高级的 CI 配置可以让 Pint 和 Rector 在 PR 中自动提交修复：

```yaml
# .github/workflows/auto-fix.yml
name: Auto Fix

on:
  pull_request:
    branches: [main]

jobs:
  auto-fix:
    name: Auto Fix Code
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'

      - run: composer install --no-interaction --prefer-dist

      - name: Run Pint
        run: ./vendor/bin/pint

      - name: Run Rector
        run: ./vendor/bin/rector process --no-ansi

      - name: Check for changes
        id: changes
        run: |
          if git diff --quiet; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Commit changes
        if: steps.changes.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .
          git commit -m "style: auto-fix code style and refactoring"
          git push
```

---

## 第五章：渐进式治理策略

### 5.1 从零开始的治理路径

对于一个从未使用过代码质量工具的 Laravel 项目，一步到位地启用所有工具的所有规则是不现实的。以下是经过实践验证的渐进式治理路径：

#### 第一阶段：基础建设（第 1-2 周）

**目标**：让三个工具都能正常运行，形成基本的工作流。

```bash
# 1. 安装工具
composer require laravel/pint rector/rector larastan/larastan --dev

# 2. 初始化配置
./vendor/bin/pint  # 自动生成 pint.json
./vendor/bin/rector init  # 生成 rector.php

# 3. 创建基础 phpstan.neon
```

基础 `phpstan.neon` 配置：

```neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app
    level: 0
    excludePaths:
        - vendor
```

这个阶段只运行 Level 0 的 PHPStan，不做任何修改，先建立信心。

#### 第二阶段：代码风格统一（第 3-4 周）

**目标**：全量格式化，统一代码风格。

```json
// pint.json
{
    "preset": "laravel",
    "rules": {
        "no_unused_imports": true,
        "ordered_imports": {
            "sort_algorithm": "alpha"
        }
    }
}
```

这个阶段的关键操作：

1. 一次性运行 `./vendor/bin/pint` 格式化全部代码
2. 创建一个专门的 PR，只包含格式化变更
3. 将这个 PR 作为 baseline，之后所有 PR 都必须通过 Pint 检查
4. 在 CI 中加入 `./vendor/bin/pint --test` 步骤

**踩坑提醒**：全量 Pint 格式化会产生大量变更，务必在单独的 PR 中进行，并告知团队不要在这个 PR 上进行代码审查——它只是格式化。

#### 第三阶段：PHPStan 渐进提升（第 5-8 周）

**目标**：从 Level 0 逐步提升到 Level 5-6。

```php
// 使用 baseline 冻结已有错误

// Step 1: 生成 baseline
./vendor/bin/phpstan analyse --generate-baseline

// Step 2: 升级 level
// 在 phpstan.neon 中将 level 从 0 改为 1

// Step 3: 修复新暴露的问题

// Step 4: 重复 step 2-3，直到达到目标 level
```

每周提升 1-2 个 Level，并在每次提升后：

1. 修复所有新暴露的问题
2. 更新 baseline
3. 在 CI 中强制执行新 Level

一个实际的时间线示例：

| 周次 | Level | 主要工作 |
|------|-------|---------|
| 第5周 | 0→2 | 添加基本类型注解 |
| 第6周 | 2→3 | 修复返回类型问题 |
| 第7周 | 3→5 | 添加严格的参数类型 |
| 第8周 | 5→6 | 处理 mixed 类型、严格比较 |

#### 第四阶段：Rector 渐进重构（第 9-12 周）

**目标**：使用 Rector 消除技术债务，升级 PHP 语法。

```php
// rector.php
use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
    ])
    ->withSets([
        // 先从代码质量规则开始
        SetList::CODE_QUALITY,
    ]);
```

渐进式引入规则集：

1. **第 9-10 周**：`SetList::CODE_QUALITY` + `SetList::DEAD_CODE`
2. **第 11 周**：`SetList::PHP_80` + `SetList::PHP_81`
3. **第 12 周**：`LaravelLevelSetList::LARAVEL_110`

每个阶段都产生一个独立的 PR，便于审查和回滚。

### 5.2 大型项目的分模块治理

对于超过 10 万行代码的大型项目，需要分模块治理：

```php
// rector.php - 按模块分批处理
return RectorConfig::configure()
    ->withPaths([
        // 第一批：核心模块
        __DIR__ . '/app/Services',
        __DIR__ . '/app/Models',
        // 第二批：HTTP 层
        // __DIR__ . '/app/Http',
        // 第三批：Console 和 Jobs
        // __DIR__ . '/app/Console',
        // __DIR__ . '/app/Jobs',
    ])
    ->withSets([
        SetList::CODE_QUALITY,
    ]);
```

```neon
# phpstan.neon - 分目录设置不同 Level
parameters:
    paths:
        - app/Services
        - app/Models

    # 对新代码使用严格级别
    level: 6

    # 通过 baseline 忽略历史错误
includes:
    - phpstan-baseline.neon
```

### 5.3 团队协作规范

### 5.2 代码质量指标量化
为了衡量治理效果，建议建立以下量化指标：
```bash
#!/bin/bash
# scripts/quality-report.sh
echo "=== Code Quality Report ==="
echo ""
# 1. Pint 违规数量
PINT_ISSUES=$(./vendor/bin/pint --test 2>&1 | grep -c "×" || true)
echo "Pint violations: $PINT_ISSUES"
# 2. Rector 待处理重构
RECTOR_CHANGES=$(./vendor/bin/rector process --dry-run 2>&1 | grep -c "Rector\\" || true)
echo "Rector changes: $RECTOR_CHANGES"
# 3. PHPStan 错误数
PHPSTAN_ERRORS=$(./vendor/bin/phpstan analyse --no-progress --error-format=json 2>&1 | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('totals',{}).get('file_errors',[])))" 2>/dev/null || echo "N/A")
echo "PHPStan errors: $PHPSTAN_ERRORS"
# 4. 类型注解覆盖率
PHP_FILES=$(find app -name "*.php" | wc -l)
TYPED_FUNCTIONS=$(grep -r "function.*):.*{" app --include="*.php" | wc -l)
TOTAL_FUNCTIONS=$(grep -r "function.*(" app --include="*.php" | wc -l)
COVERAGE=$((TYPED_FUNCTIONS * 100 / TOTAL_FUNCTIONS))
echo "Type annotation coverage: ${COVERAGE}% ($TYPED_FUNCTIONS/$TOTAL_FUNCTIONS)"
echo ""
echo "=== End of Report ==="
```
定期运行这个脚本，可以直观地看到治理效果。建议每周生成一次报告，记录在项目的 Wiki 或文档中，作为团队改进的参考。
### 5.3 大型项目的分模块治理 @@
#### 5.3.1 Code Review 清单

将三剑客集成到 Code Review 流程中：

```markdown
## Code Review Checklist

### 自动化检查（CI 必须通过）
- [ ] Pint 格式化通过
- [ ] Rector 无待处理重构
- [ ] PHPStan Level 6 通过

### 人工检查
- [ ] 新增代码是否有完整的类型注解？
- [ ] Eloquent 关系是否正确注解了泛型？
- [ ] 新增方法是否添加了 PHPDoc？
- [ ] 是否有 Rector 无法自动处理的遗留代码需要手动重构？
```

#### 5.3.2 IDE 集成

确保团队成员的 IDE 都配置了相关插件：

**VS Code 配置（`.vscode/settings.json`）：**

```json
{
    "phpstan.enabled": true,
    "phpstan.path": "${workspaceFolder}/vendor/bin/phpstan",
    "phpstan.level": 6,
    "phpstan.neonFilePath": "${workspaceFolder}/phpstan.neon",
    "[php]": {
        "editor.defaultFormatter": "junstyle.php-cs-fixer",
        "editor.formatOnSave": true
    },
    "php-cs-fixer.executablePath": "${workspaceFolder}/vendor/bin/pint",
    "php-cs-fixer.onsave": true
}
```

**PhpStorm 配置：**

1. File Watchers：配置 Pint 在保存时自动运行
2. PHPStan Integration：在 Settings → PHP → Quality Tools → PHPStan 中配置
3. External Tools：添加 Rector 作为外部工具

---

## 第六章：真实项目踩坑实录

### 6.1 踩坑一：Pint 与 IDE 格式化冲突

**问题描述**：团队成员使用不同的 IDE（PhpStorm、VS Code、Sublime Text），IDE 自带的格式化功能与 Pint 产生冲突，导致反复格式化。

**解决方案**：

1. 统一使用 Pint 作为唯一的格式化工具，禁用 IDE 自带的 PHP 格化功能
2. 配置 EditorConfig 统一基本格式：

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.php]
indent_style = space
indent_size = 4
```

3. 在 pre-commit hook 中运行 Pint，确保无论 IDE 如何配置，提交的代码都符合规范

### 6.2 踩坑二：Rector 修改了不该修改的文件

**问题描述**：Rector 在运行时修改了 `database/migrations` 中的迁移文件和一些第三方生成的代码。

**解决方案**：

```php
// rector.php
return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
    ])
    ->withSkip([
        // 排除迁移文件
        __DIR__ . '/database/migrations',
        // 排除 IDE 辅助文件
        __DIR__ . '/_ide_helper*.php',
        // 排除特定的遗留类
        __DIR__ . '/app/Legacy',
        // 排除使用了复杂魔术方法的类
        __DIR__ . '/app/Traits/Magical.php',
    ]);
```

### 6.3 踩坑三：PHPStan 分析 Eloquent Builder 超时

**问题描述**：在大型项目中，PHPStan 分析 Eloquent 查询时经常超时，特别是使用了复杂 `whereHas` 和嵌套关系的查询。

**解决方案**：

1. 增加内存限制：

```bash
./vendor/bin/phpstan analyse --memory-limit=4G
```

2. 使用 `phpstan-baseline.neon` 冻结复杂的 Eloquent 错误：

```neon
# phpstan-baseline.neon
parameters:
    ignoreErrors:
        -
            identifier: method.notFound
            message: '#Call to an undefined method .*Builder::#'
            count: 50
            reportUnmatched: false
```

3. 对于特别复杂的查询，使用 `@phpstan-ignore-next-line`：

```php
/** @phpstan-ignore-next-line method.notFound */
$results = User::query()
    ->whereHas('posts', function ($query) {
        $query->where('status', 'published');
    })
    ->get();
```

### 6.4 踩坑四：Rector 与 PHPStan 规则冲突

**问题描述**：Rector 的某些重构（如添加类型声明）与 PHPStan 的某些检查规则产生冲突，导致循环报错。

**解决方案**：

1. **固定执行顺序**：始终先运行 Rector，再运行 PHPStan

```json
{
    "scripts": {
        "quality": [
            "@pint",
            "@rector",
            "@phpstan"
        ]
    }
}
```

2. **分别更新 baseline**：当 Rector 修改了代码后，需要重新生成 PHPStan baseline

```bash
# 更新 Rector 的变更
./vendor/bin/rector process

# 重新生成 baseline
./vendor/bin/phpstan analyse --generate-baseline
```

3. **协调版本升级节奏**：避免同时升级 Rector 规则和 PHPStan Level

### 6.5 踩坑五：Pint 的 `declare_strict_types` 规则引发大量错误

**问题描述**：在 `pint.json` 中开启了 `declare_strict_types`，这会导致所有文件都添加 `declare(strict_types=1)`，然后 PHPStan 开始报告大量严格类型错误。

**解决方案**：

分两步走：

```json
// Step 1: 先不开 declare_strict_types
{
    "preset": "laravel",
    "rules": {
        "no_unused_imports": true,
        "ordered_imports": {"sort_algorithm": "alpha"}
    }
}

// Step 2: 代码稳定后再开启
{
    "preset": "laravel",
    "rules": {
        "declare_strict_types": true,
        "no_unused_imports": true,
        "ordered_imports": {"sort_algorithm": "alpha"},
        "void_return": true
    }
}
```

或者更灵活地按目录分批开启：

```php
// scripts/enable-strict-types.php
<?php

$directories = [
    'app/Services',
    'app/Models',
    'app/Actions',
    'app/Http/Controllers',
];

foreach ($directories as $directory) {
    $files = glob("$directory/*.php");
    foreach ($files as $file) {
        $content = file_get_contents($file);
        if (strpos($content, 'declare(strict_types=1)') === false) {
            $content = "<?php\n\ndeclare(strict_types=1);\n\n" . ltrim(substr($content, 5));
            file_put_contents($file, $content);
        }
    }
}
```

### 6.6 踩坑六：CI 中 Composer 依赖安装缓慢

**问题描述**：三个工具加上它们的依赖，`composer install` 在 CI 中经常花费 3-5 分钟。

**解决方案**：

1. **使用 Composer 缓存**：

```yaml
- name: Cache Composer packages
  uses: actions/cache@v4
  with:
    path: vendor
    key: ${{ runner.os }}-php-${{ hashFiles('**/composer.lock') }}
    restore-keys: |
      ${{ runner.os }}-php-
```

2. **使用 `--prefer-dist` 和 `--no-dev` 的精简安装**：

```bash
composer install --no-interaction --prefer-dist --optimize-autoloader --no-scripts
```

3. **考虑使用 Docker 预构建镜像**：

```dockerfile
FROM php:8.3-cli

RUN apt-get update && apt-get install -y git unzip

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-interaction --prefer-dist --no-scripts --no-autoloader

COPY . .
RUN composer dump-autoload --optimize
```

### 6.7 踩坑七：Rector 升级 Laravel 11 的 Kernel 问题

**问题描述**：从 Laravel 10 升级到 Laravel 11 时，Rector 尝试删除 `app/Http/Kernel.php`，但项目中有自定义的中间件分组配置。

**解决方案**：

1. 不要让 Rector 直接处理 Kernel 文件，手动处理：

```php
// rector.php
return RectorConfig::configure()
    ->withSkip([
        __DIR__ . '/app/Http/Kernel.php',
        __DIR__ . '/app/Console/Kernel.php',
        __DIR__ . '/app/Exceptions/Handler.php',
    ]);
```

2. 手动将 Kernel 中的中间件配置迁移到 `bootstrap/app.php`：

```php
// bootstrap/app.php (Laravel 11)
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [
            \App\Http\Middleware\TrustHosts::class,
        ]);

        $middleware->api(prepend: [
            \App\Http\Middleware\ForceJsonResponse::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
```

### 6.8 踩坑八：PHPStan 分析第三方包接口报错

**问题描述**：某些第三方包（如旧版的 Spatie 包）缺少类型注解，导致 PHPStan 报错。

**解决方案**：

1. **使用 stub 文件**：

```neon
# phpstan.neon
parameters:
    stubFiles:
        - stubs/spatie-medialibrary.stub
```

```php
// stubs/spatie-medialibrary.stub
namespace Spatie\MediaLibrary\HasMedia;

interface HasMedia
{
    /**
     * @return \Spatie\MediaLibrary\MediaCollections\Models\Collections\MediaCollection<int, \Spatie\MediaLibrary\MediaCollections\Models\Media>
     */
    public function getMedia(string $collectionName = 'default'): MediaCollection;
}
```

2. **使用 `ignoreErrors` 精确忽略**：

```neon
parameters:
    ignoreErrors:
        -
            identifier: method.notFound
            message: '#Spatie\\MediaLibrary#'
            reportUnmatched: false
```

---

## 第七章：高级技巧与最佳实践

### 7.1 自定义 Composer 脚本的错误处理

```json
{
    "scripts": {
        "quality": [
            "@pint",
            "@rector",
            "@phpstan"
        ],
        "quality:ci": [
            "@pint:test || (echo 'Pint check failed' && exit 1)",
            "@rector:dry || (echo 'Rector check failed' && exit 1)",
            "@phpstan || (echo 'PHPStan check failed' && exit 1)"
        ]
    }
}
```

### 7.2 PHPStan 的自定义规则扩展

编写项目级的 PHPStan 规则，检查特定的编码规范：

```php
<?php

declare(strict_types=1);

namespace App\PHPStan\Rules;

use PhpParser\Node;
use PhpParser\Node\Stmt\ClassMethod;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<ClassMethod>
 */
class ControllerMethodMustReturnTypeRule implements Rule
{
    public function getNodeType(): string
    {
        return ClassMethod::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        // 检查是否在 Controller 目录下
        $fileName = $scope->getFile();
        if (! str_contains($fileName, 'Http/Controllers')) {
            return [];
        }

        // 检查 public 方法是否有返回类型
        if ($node->isPublic() && $node->returnType === null) {
            return [
                sprintf(
                    'Controller method %s::%s must have a return type declaration',
                    $scope->getClassReflection()?->getName(),
                    $node->name->name
                ),
            ];
        }

        return [];
    }
}
```

注册自定义规则：

```neon
# phpstan.neon
services:
    -
        class: App\PHPStan\Rules\ControllerMethodMustReturnTypeRule
        tags:
            - phpstan.rules.rule
```

### 7.3 使用 PHP-CS-Fixer 的配置文件迁移

如果项目之前使用的是 PHP-CS-Fixer，迁移到 Pint 非常简单：

```bash
# 1. 将 .php-cs-fixer.dist.php 中的规则提取到 pint.json
# 2. 安装 Pint
composer require laravel/pint --dev

# 3. 删除旧的配置文件
rm .php-cs-fixer.dist.php .php-cs-fixer.php

# 4. 卸载 PHP-CS-Fixer
composer remove friendsofphp/php-cs-fixer --dev
```

### 7.4 Rector 的 Sets 按优先级排序

```php
return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withSets([
        // 先清理死代码（减少噪音）
        SetList::DEAD_CODE,
        // 再提升代码质量
        SetList::CODE_QUALITY,
        // 然后进行语法升级
        SetList::PHP_80,
        SetList::PHP_81,
        SetList::PHP_82,
        SetList::PHP_83,
        // 最后处理框架特定的变更
        LaravelLevelSetList::LARAVEL_110,
    ]);
```

### 7.5 PHPStan 的 Performance 优化

对于大型项目，PHPStan 分析可能很慢。以下是一些优化技巧：

```neon
# phpstan.neon
parameters:
    # 使用并行处理（需要 phpstan/phpstan >= 1.10）
    parallel:
        maximumNumberOfProcesses: 4

    # 排除不需要分析的目录
    excludePaths:
        - tests/Fixtures
        - storage
        - bootstrap/cache

    # 使用 result cache
    tmpDir: tmp/phpstan
```

```bash
# 使用 result cache 加速重复分析
./vendor/bin/phpstan analyse --memory-limit=2G

# 第一次分析可能较慢，之后会使用缓存
# 清除缓存
./vendor/bin/phpstan clear-result-cache
```

### 7.6 三工具配置的版本管理

将配置文件纳入版本控制，并在团队文档中说明每个配置的含义：

```
project-root/
├── pint.json           # Pint 配置
├── rector.php          # Rector 配置
├── phpstan.neon        # PHPStan 配置
├── phpstan-baseline.neon # PHPStan baseline（也纳入版本控制）
├── .editorconfig       # 编辑器基本配置
├── scripts/
│   └── pre-commit      # Git hook 脚本
└── docs/
    └── code-quality.md # 团队文档
```

---

## 第八章：实战案例——从 Level 0 到 Level 6 的完整旅程

### 8.1 项目背景

假设我们有一个典型的 Laravel 11 电商项目，代码量约 5 万行，团队 8 人，PHP 8.3。项目特点：

- 从未使用过静态分析工具
- 代码风格不统一（部分人使用 Tab，部分使用空格）
- 有大量遗留代码（从 Laravel 8 逐步升级而来）
- Eloquent 关系缺乏类型注解
- Controller 方法大部分没有返回类型

### 8.2 第一周：环境搭建与 Pint 全量格式化

```bash
# 安装工具
composer require laravel/pint rector/rector larastan/larastan --dev

# Pint 配置
cat > pint.json << 'EOF'
{
    "preset": "laravel",
    "rules": {
        "no_unused_imports": true,
        "ordered_imports": {
            "sort_algorithm": "alpha",
            "imports_order": ["class", "function", "const"]
        }
    }
}
EOF

# 全量格式化
./vendor/bin/pint

# 查看变更统计
git diff --stat | tail -1
# 输出类似：142 files changed, 2847 insertions(+), 3201 deletions(-)

# 创建 PR
git checkout -b chore/code-style-pint
git add .
git commit -m "style: apply Laravel Pint formatting to entire codebase"
git push origin chore/code-style-pint
```

### 8.3 第二周：PHPStan Level 0-2

```neon
# phpstan.neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app
    level: 0
```

```bash
# 首次运行
./vendor/bin/phpstan analyse --level=0 --error-format=table 2>&1 | tee phpstan-level0.txt

# 统计错误数量
grep -c "^" phpstan-level0.txt
# 假设：0 errors (Level 0 基本都能通过)

# 升级到 Level 1
sed -i 's/level: 0/level: 1/' phpstan.neon
./vendor/bin/phpstan analyse 2>&1 | tee phpstan-level1.txt
# 假设发现 15 个错误

# 修复这些错误...

# 升级到 Level 2
sed -i 's/level: 1/level: 2/' phpstan.neon
./vendor/bin/phpstan analyse 2>&1 | tee phpstan-level2.txt
# 假设发现 23 个错误
```

### 8.4 第三周：PHPStan Level 3-5

这个阶段是最痛苦的，需要大量的类型注解工作。一些典型的修复：

```php
// Before
class OrderService
{
    public function createOrder($userId, $items)
    {
        $user = User::find($userId);
        $order = Order::create([
            'user_id' => $user->id,
            'total' => collect($items)->sum('price'),
        ]);
        return $order;
    }
}

// After
class OrderService
{
    public function createOrder(int $userId, array $items): Order
    {
        /** @var User $user */
        $user = User::findOrFail($userId);

        /** @var Order $order */
        $order = Order::create([
            'user_id' => $user->id,
            'total' => collect($items)->sum('price'),
        ]);

        return $order;
    }
}
```

### 8.5 第四周：PHPStan Level 6 + Baseline

```bash
# 生成 baseline 冻结剩余错误
./vendor/bin/phpstan analyse --level=6 --generate-baseline

# CI 中强制执行 Level 6
```

### 8.6 第五周：Rector 代码质量重构

```php
// rector.php
use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;

return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withSkip([
        __DIR__ . '/database/migrations',
    ])
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
    ]);
```

```bash
# 先看看会有什么变更
./vendor/bin/rector process --dry-run

# 确认无误后执行
./vendor/bin/rector process

# 重新生成 PHPStan baseline
./vendor/bin/phpstan analyse --generate-baseline
```

### 8.7 第六周：Rector PHP 版本升级

```php
// 更新 rector.php
return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withSkip([
        __DIR__ . '/database/migrations',
    ])
    ->withPhpSets(php83: true)
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
    ]);
```

```bash
./vendor/bin/rector process --dry-run 2>&1 | head -50
# 查看预览的变更
./vendor/bin/rector process
```

### 8.8 最终状态：完整流水线

```json
// composer.json
{
    "scripts": {
        "pint": "./vendor/bin/pint",
        "pint:test": "./vendor/bin/pint --test",
        "rector": "./vendor/bin/rector process",
        "rector:dry": "./vendor/bin/rector process --dry-run",
        "phpstan": "./vendor/bin/phpstan analyse --memory-limit=2G",
        "quality": ["@pint", "@rector", "@phpstan"],
        "quality:check": ["@pint:test", "@rector:dry", "@phpstan"]
    }
}
```

```yaml
# .github/workflows/quality.yml
name: Quality Pipeline
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-interaction --prefer-dist
      - run: ./vendor/bin/pint --test
      - run: ./vendor/bin/rector process --dry-run
      - run: ./vendor/bin/phpstan analyse --memory-limit=2G
```

---

## 第九章：工具链的未来展望

### 9.1 PHP 生态的演进方向

PHP 语言本身在持续进化。PHP 8.4 引入了属性钩子（Property Hooks）、不对称可见性（Asymmetric Visibility）等新特性，这将进一步推动 Rector 的自动化重构需求。同时，随着 PHP 类型系统的增强，PHPStan 的分析能力也将持续提升。

### 9.2 AI 辅助的质量治理

随着 AI 编程助手的普及，未来的代码质量治理可能会出现以下趋势：

1. **智能修复建议**：PHPStan 报错后，AI 自动提供修复方案
2. **自动化重构决策**：AI 判断哪些代码适合使用 Rector 自动重构，哪些需要人工介入
3. **自适应规则配置**：根据项目特点自动推荐最佳的 Pint/Rector/PHPStan 配置

### 9.3 与 Laravel 生态的进一步整合

Laravel 官方已经在 2024 年将 Pint 作为默认的代码格式化工具纳入新项目。未来，我们可能会看到：

1. **Laravel 官方推荐的 Rector 规则集**：针对每个 Laravel 版本的标准化迁移路径
2. **PHPStan Larastan 的深度整合**：Laravel 可能在 `artisan` 命令中集成静态分析
3. **统一的质量命令**：`php artisan quality` 可能成为现实

---

## 第十章：常见问题解答（FAQ）

在结束之前，我们整理一些团队在实施过程中最常问到的问题：

**Q：三个工具会不会导致开发变慢？**

A：短期来看，确实会增加一些开发时间，特别是在初期修复历史问题的阶段。但从长期来看，代码质量提升后，Code Review 的时间会缩短，线上 Bug 会减少，重构的信心会增强。根据多个团队的反馈，在实施 3 个月后，整体开发效率反而提升了 15-20%。

**Q：应该在项目初期就引入这三个工具吗？**

A：强烈建议在项目初期就引入 Pint，它的零配置特性和即时收益使其几乎没有门槛。PHPStan 建议在项目稳定后（大约 2-3 周）引入，从 Level 0 开始。Rector 可以在有技术债务需要清理时再引入，通常在项目运行 3-6 个月后比较合适。

**Q：如果团队中有人不愿意遵守这些规范怎么办？**

A：这是最常见的团队协作问题。解决方案是将工具检查集成到 CI 流水线中，让机器来执行规则，而不是人工提醒。这样既避免了人际关系的紧张，又能保证规则的一致执行。同时，建议在引入工具时充分沟通目的和收益，让团队成员理解这是为了提升代码质量，而不是限制个人自由。

**Q：如何处理三个工具之间的冲突？**

A：Pint 和 Rector 之间基本不会冲突，因为它们分别负责风格和结构。PHPStan 和 Rector 之间偶尔会有冲突，特别是在类型声明方面。解决方法是固定执行顺序（先 Rector 后 PHPStan），并在 Rector 修改代码后及时更新 PHPStan baseline。

**Q：这三个工具的维护成本高吗？**

A：维护成本主要体现在两个方面：一是工具本身的版本升级（大约每 1-2 个月更新一次），二是配置文件的微调。对于一个 5 万行代码的项目，每周大约需要花 1-2 小时来维护这些工具。这个投入与它们带来的收益相比，是非常划算的。

**Q：是否可以用 Psalm 替代 PHPStan？**

A：技术上可以，但 Laravel 生态中 Larastan（PHPStan 的 Laravel 扩展）比 Psalm 的 Laravel 支持更加成熟。如果你的项目不是 Laravel 项目，Psalm 也是一个很好的选择。对于 Laravel 项目，推荐使用 PHPStan + Larastan 的组合。

**Q：如何说服管理层投入时间做代码质量治理？**

A：从量化数据入手。先统计每个月因为代码质量问题导致的线上故障数量和修复时间，然后计算三剑客能预防多少问题。通常，一个中等规模的项目每月因为类型错误和代码风格不一致导致的问题，大约需要 2-4 个工作日来修复。引入三剑客后，这些问题可以在开发阶段就被发现和解决，节省的时间远超工具维护的成本。此外，代码质量的提升还有助于降低新人的上手难度，缩短 Onboarding 周期，这些都是可以量化的收益。

**Q：三剑客是否支持 Monorepo 架构？**

A：支持，但需要额外的配置。对于 Monorepo 项目，建议在每个子包中维护独立的配置文件，同时在根目录使用统一的 CI 流水线。Pint 和 PHPStan 都支持指定多个路径，Rector 也支持 `withPaths()` 配置多个目录。需要注意的是，在 Monorepo 中运行这些工具时，性能问题可能更加突出，建议使用并行处理和缓存机制来优化执行速度。

---

## 总结

本文从实战角度详细介绍了 Laravel Pint + Rector + PHPStan 三剑客的联动方案。核心要点回顾：

1. **Pint** 负责代码风格统一，零配置即可使用，支持高度自定义
2. **Rector** 负责自动重构，覆盖 PHP 版本升级、框架迁移、代码质量提升
3. **PHPStan** 负责类型安全和静态分析，通过 Level 体系实现渐进式严格化
4. **三者联动** 需要注意执行顺序：Pint → Rector → PHPStan
5. **渐进式治理** 是大型项目的唯一可行路径，切忌一步到位
6. **CI/CD 集成** 是保证质量的最后防线，所有变更必须通过流水线检查

代码质量治理不是一个一劳永逸的任务，而是一个持续改进的过程。三剑客联动为我们提供了一套完整的工具链，让这个过程变得可量化、可自动化、可持续。希望本文的内容能帮助你在实际项目中构建出高效的质量治理流水线，让团队的开发效率和代码质量同步提升。

---

## 附录：完整配置文件参考
### D. GitHub Actions 缓存优化配置
```yaml
# .github/workflows/cache.yml
name: Cache Setup
on: push
jobs:
  cache:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ hashFiles('composer.lock') }}
      - name: Cache PHPStan
        uses: actions/cache@v4
        with:
          path: tmp/phpstan
          key: phpstan-${{ github.sha }}
          restore-keys: phpstan-
      - run: composer install --no-interaction --prefer-dist
```
### E. 团队培训建议
在引入三剑客之前，建议团队先进行以下培训：
1. **Pint 培训（1 小时）**：讲解基本配置和自定义规则，让每个开发者都能在本地运行 Pint
2. **Rector 培训（2 小时）**：讲解 Rector 的工作原理、常见规则集、以及如何编写自定义规则
3. **PHPStan 培训（3 小时）**：重点讲解类型系统、PHPDoc 注解、以及如何处理常见错误

培训后，建议设置 1-2 周的"试运行期"，在此期间工具只产生警告，不阻塞 CI。等团队成员都熟悉工具后，再正式启用 CI 阻塞。


### A. pint.json 完整配置

```json
{
    "preset": "laravel",
    "exclude": [
        "vendor",
        "storage",
        "bootstrap/cache",
        "node_modules",
        "database/migrations"
    ],
    "notName": [
        "*.blade.php",
        "_ide_helper*.php"
    ],
    "rules": {
        "declare_strict_types": true,
        "void_return": true,
        "array_syntax": {
            "syntax": "short"
        },
        "ordered_imports": {
            "sort_algorithm": "alpha",
            "imports_order": ["class", "function", "const"]
        },
        "no_unused_imports": true,
        "single_quote": true,
        "trailing_comma_in_multiline": true,
        "simplified_null_return": true,
        "phpdoc_separation": true,
        "phpdoc_order": true,
        "phpdoc_trim": true,
        "phpdoc_types_order": {
            "null_adjustment": "always_last"
        },
        "no_empty_statement": true,
        "no_extra_blank_lines": {
            "tokens": ["extra", "throw", "use", "return"]
        },
        "ternary_to_null_coalescing": true,
        "nullable_type_declaration_for_default_null_value": true
    }
}
```

### B. rector.php 完整配置

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;
use Rector\Laravel\Set\LaravelLevelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/routes',
        __DIR__ . '/tests',
    ])
    ->withSkip([
        __DIR__ . '/vendor',
        __DIR__ . '/storage',
        __DIR__ . '/bootstrap/cache',
        __DIR__ . '/database/migrations',
        __DIR__ . '/_ide_helper*.php',
    ])
    ->withPhpSets(php83: true)
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
        LaravelLevelSetList::LARAVEL_110,
    ]);
```

### C. phpstan.neon 完整配置

```neon
includes:
    - vendor/larastan/larastan/extension.neon
    - phpstan-baseline.neon

parameters:
    paths:
        - app

    level: 6

    tmpDir: tmp/phpstan

    parallel:
        maximumNumberOfProcesses: 4

    excludePaths:
        - vendor
        - storage
        - bootstrap/cache
        - tests/Fixtures

    ignoreErrors:
        - '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder::[a-zA-Z]+#'
        - '#Call to an undefined method Illuminate\\Database\\Query\\Builder::[a-zA-Z]+#'

    reportUnmatchedIgnoredErrors: true
    checkMissingIterableValueType: true
    checkGenericClassInSemiGenericTypes: true

    bootstrapFiles:
        - app/Helpers/helpers.php
```

---

## 第八章：工具选型对比

### 8.1 代码风格工具对比

| 维度 | Laravel Pint | PHP-CS-Fixer | EasyCodingStandard |
|------|-------------|--------------|-------------------|
| 维护方 | Laravel 官方 | FriendsOfPHP | Symplify (Tomas Votruba) |
| 安装复杂度 | 极低（Laravel 项目直接用） | 低 | 中等 |
| 配置复杂度 | 极低（零配置可用） | 中等（需手动配置规则） | 中等 |
| 规则数量 | 精选子集 | 500+ 条规则 | 支持 PHP-CS-Fixer + Sniffs |
| 性能 | 快 | 中等 | 快（并行处理） |
| Laravel 集成 | 深度集成 | 通用 | 通用 |
| 自定义规则 | 通过 PHP-CS-Fixer 扩展 | 原生支持 | 支持 |
| 推荐场景 | Laravel 项目首选 | 通用 PHP 项目 | 需要混合规则集 |

### 8.2 静态分析工具对比

| 维度 | PHPStan | Psalm | Phan |
|------|---------|-------|------|
| 维护方 | Ondřej Mirtes | Vimeo (已停止维护) | Rasmus Lerdorf / Etsy |
| 活跃度 | 非常活跃 | 已归档（2024） | 低活跃 |
| 类型推断能力 | 最强（Level 0-9） | 强 | 中等 |
| Laravel 支持 | larastan 扩展 | psalm-laravel-plugin | 基础支持 |
| 性能 | 快（并行处理） | 中等 | 中等 |
| 错误信息质量 | 优秀 | 优秀 | 一般 |
| 自定义规则 | PHPStan Extensions | Plugins | Plugins |
| 推荐场景 | 通用首选（2025+） | 历史项目 | 历史项目 |

> **注意**：Psalm 已于 2024 年停止维护，新项目强烈推荐 PHPStan。PHPStan 与 Rector 的集成度最高，两者由同一社区维护。

---

*感谢阅读！如果这篇文章对你有帮助，欢迎分享给更多的 Laravel 开发者。代码质量的提升需要团队共同努力，三剑客联动只是工具，持续改进的心态才是关键。*

---

## 相关阅读

- [PHP 内存模型深度剖析：引用计数、写时复制、垃圾回收的底层机制与性能调优](/post/PHP-内存模型深度剖析-引用计数-写时复制-垃圾回收的底层机制与性能调优.html)
- [Laravel Pipeline 重构实战](/post/Laravel-12x-Pipeline-重构实战.html)
- [Dependency Injection 容器深度对比：Laravel Container vs Symfony DI vs PHP-DI](/post/Dependency-Injection-容器深度对比-Laravel-Container-vs-Symfony-DI-vs-PHP-DI-的设计哲学.html)
- [PHP 8.5 新特性前瞻：属性钩子、JIT 改进与异步生态演进](/post/2026-06-02-PHP-8.5-新特性前瞻-属性钩子-JIT改进与异步生态演进.html)

