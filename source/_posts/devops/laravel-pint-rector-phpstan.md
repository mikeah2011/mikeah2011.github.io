---

title: Laravel Pint + Rector + PHPStan 三剑客联动：代码风格+重构+类型安全的一站式质量治理流水线
keywords: [Laravel Pint, Rector, PHPStan, 三剑客联动, 代码风格, 重构, 类型安全的一站式质量治理流水线]
date: 2026-06-03 00:00:00
tags:
- Laravel
- PHP
- Pint
- Rector
- PHPStan
- code quality
- Static Analysis
categories:
- devops
description: Laravel Pint + Rector + PHPStan 三剑客联动实战：一站式代码质量治理流水线。覆盖 Pint 代码风格自动格式化、Rector 自动化重构与 PHP 语法升级、PHPStan 静态类型分析的完整集成方案，包括 composer 脚本串联、CI/CD 管道配置、自定义规则编写、渐进式类型提升策略与常见踩坑记录。附 Pint vs PHP-CS-Fixer、Rector vs PHPStan 方案对比表格，帮助 Laravel 团队从零搭建企业级代码质量防线。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




# Laravel Pint + Rector + PHPStan 三剑客联动：代码风格+重构+类型安全的一站式质量治理流水线

在现代 Laravel 项目的开发生命周期中，代码质量保障早已不再是"锦上添花"的可选项，而是"不可或缺"的必选项。随着项目规模的增长、团队人数的扩充，代码风格不统一、遗留语法泛滥、类型安全缺失这三大"顽疾"会迅速侵蚀项目的可维护性和可读性。

幸运的是，PHP 生态在近年来涌现出了三款极其优秀的工具，分别精准地击中了上述三个痛点：

- **Laravel Pint** —— 代码风格的自动格式化利器
- **Rector** —— 自动化重构与语法升级的瑞士军刀
- **PHPStan** —— 静态类型分析的终极防线

这三款工具各有所长，但单独使用时往往只能解决局部问题。只有将它们有机地串联成一条完整的质量治理流水线，才能真正实现从"代码风格"到"语法现代化"再到"类型安全"的全方位覆盖。

本文将深入探讨如何在 Laravel 项目中将这三剑客完美联动，从各自的基本原理讲起，逐步深入到配置细节、冲突解决、CI/CD 集成，最终构建一套可复制、可维护的一站式质量治理流水线。

---

## 一、为什么需要"三剑客联动"？

### 1.1 三大核心问题

在一个典型的 Laravel 项目中，代码质量问题通常可以归结为以下三个层面：

**代码风格不一致（Code Style）**

不同开发者有不同的编码习惯——有人喜欢在数组末尾加逗号，有人不喜欢；有人用 `array()` 语法，有人用 `[]` 短语法；有人在方法链调用时每个方法换一行，有人挤在一行里。这些看似微小的差异，在代码审查时会消耗大量时间，也会让代码库显得杂乱无章。

**遗留语法与过时模式（Legacy Code & Outdated Patterns）**

PHP 语言本身在快速演进——从 PHP 5.x 到 7.x 再到 8.x，每个版本都引入了大量新特性：箭头函数、命名参数、联合类型、枚举、只读属性、匹配表达式……但项目中往往积累了大量使用旧语法的代码。手动逐一改造这些代码既枯燥又容易出错。

**类型安全缺失（Type Safety）**

PHP 是一门动态类型语言，虽然近年来不断加强类型系统的表达力，但大量项目仍然缺乏完整的类型标注。没有类型标注的代码不仅 IDE 无法提供准确的自动补全，更严重的是，很多隐性 Bug 只有在运行时才会暴露，而无法在开发阶段被提前捕获。

### 1.2 工具选型的考量

| 问题层面 | 工具 | 核心能力 | 代表特性 |
|---------|------|---------|---------|
| 代码风格 | Laravel Pint | 自动格式化，统一编码规范 | Laravel 风格开箱即用 |
| 重构升级 | Rector | 语法升级，自动重构，死代码清理 | 400+ 内置规则 |
| 类型安全 | PHPStan | 静态分析，类型推断，Bug 预防 | 9 个严格级别 |

### 1.3 联动的必要性

为什么要将这三者联动，而不是各自为战？原因有三：

**执行顺序很重要。** Pint 负责格式化代码风格，Rector 负责重构代码结构，PHPStan 负责分析类型安全。如果先运行 PHPStan 再运行 Rector，Rector 的重构操作可能会引入新的类型问题；如果先运行 Rector 再运行 Pint，Rector 生成的代码可能不符合风格规范。正确的顺序是：**Pint → Rector → PHPStan**。

**配置之间有依赖。** Pint 和 Rector 都可能修改代码文件，PHPStan 的分析结果依赖于它们修改后的最终代码。如果三个工具的配置不协调，可能会产生"振荡"——Pint 格式化后 Rector 又改回去了，Rector 改完后 PHPStan 又报错了。

**统一的 CI 集成更高效。** 在 CI/CD 流水线中，与其为三个工具分别配置三套独立的 Job，不如将它们整合为一条流水线，一个 commit 一次检测，失败了统一反馈。

---

## 二、工具深度解析

### 2.1 Laravel Pint：代码风格的自动化守护者

#### 2.1.1 Pint 是什么

Laravel Pint 是 Laravel 官方推出的一款代码风格自动修复工具，它的底层实际上是 [PHP-CS-Fixer](https://github.com/PHP-CS-Fixer/PHP-CS-Fixer) 的一层精简包装。Pint 的设计哲学是"约定优于配置"——对于 Laravel 项目来说，你几乎不需要任何配置就能获得一套合理的默认代码风格规则。

#### 2.1.2 安装 Pint

```bash
# 对于 Laravel 10+ 项目，Pint 已经作为 dev 依赖预装
# 如果是全新项目或手动安装：
composer require laravel/pint --dev
```

安装完成后，你可以在 `vendor/bin/pint` 找到可执行文件。

#### 2.1.3 基本使用

```bash
# 检查哪些文件需要格式化（dry-run 模式）
./vendor/bin/pint --test

# 自动修复所有文件的代码风格
./vendor/bin/pint

# 只格式化特定文件或目录
./vendor/bin/pint app/Services

# 格式化单个文件
./vendor/bin/pint app/Models/User.php

# 查看详细变更（verbose 模式）
./vendor/bin/pint -v
```

#### 2.1.4 配置详解

Pint 的配置文件位于项目根目录 `pint.json`。以下是一个针对中大型 Laravel 项目的推荐配置：

```json
{
    "preset": "laravel",
    "rules": {
        "@PSR12": true,
        "array_syntax": {
            "syntax": "short"
        },
        "ordered_imports": {
            "sort_algorithm": "alpha"
        },
        "no_unused_imports": true,
        "single_quote": true,
        "trailing_comma_in_multiline": {
            "elements": ["arrays", "match", "parameters"]
        },
        "nullable_type_declaration_for_default_null_value": true,
        "declare_strict_types": true,
        "global_namespace_import": {
            "import_classes": true,
            "import_functions": false,
            "import_constants": false
        },
        "no_superfluous_phpdoc_tags": {
            "allow_mixed": true,
            "allow_unused_params": true
        },
        "phpdoc_order": true,
        "phpdoc_separation": true,
        "phpdoc_trim": true,
        "class_attributes_separation": {
            "elements": {
                "method": "one",
                "property": "one",
                "trait_import": "one"
            }
        },
        "method_chaining_indentation": true,
        "no_empty_statement": true,
        "no_extra_blank_lines": {
            "tokens": [
                "extra",
                "throw",
                "use",
                "use_trait"
            ]
        },
        "concat_space": {
            "spacing": "one"
        },
        "not_operator_with_successor_space": true,
        "object_operator_without_whitespace": true,
        "binary_operator_spaces": {
            "default": "single_space"
        }
    },
    "exclude": [
        "vendor",
        "storage",
        "bootstrap/cache",
        "database/migrations"
    ],
    "not-name": [
        "*-old.php",
        "*cache*"
    ]
}
```

#### 2.1.5 关键规则解读

**`declare_strict_types: true`** —— 这是一个非常重要的规则，它会为每个 PHP 文件自动添加 `declare(strict_types=1);`。这是类型安全的第一道防线，配合 PHPStan 使用效果更佳。

**`ordered_imports`** —— 自动按字母顺序排列 `use` 语句，消除 import 排列的争论。

**`no_unused_imports`** —— 自动删除未使用的 `use` 语句，保持代码整洁。

**`trailing_comma_in_multiline`** —— 在多行数组、match 表达式和函数参数末尾自动添加逗号，这在 Git diff 中能清晰地显示每一行的真实变更。

#### 2.1.6 Pint 实战：Before & After

**改造前：**

```php
<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;
use App\Services\PaymentService;
use App\Models\User;
use App\Events\OrderCreated;

class OrderController extends Controller
{
    public function store(Request $request)
    {
        $data=$request->validate([
            'product_id'=>'required|exists:products,id',
            'quantity'=>'required|integer|min:1',
            'address'=>'required|string|max:500'
        ]);

        $user=User::find(auth()->id());
        $order= new Order;
        $order->user_id=$user->id;
        $order->product_id=$data['product_id'];
        $order->quantity=$data['quantity'];
        $order->address=$data['address'];
        $order->status='pending';
        $order->save();

        $paymentService=new PaymentService();
        $paymentUrl=$paymentService->createPayment($order);

        event( new OrderCreated($order) );

        return response()->json([
            'order'=>$order,
            'payment_url'=>$paymentUrl
        ],201);
    }
}
```

**Pint 修复后：**

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Events\OrderCreated;
use App\Models\Order;
use App\Models\User;
use App\Services\PaymentService;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'product_id' => 'required|exists:products,id',
            'quantity' => 'required|integer|min:1',
            'address' => 'required|string|max:500',
        ]);

        $user = User::find(auth()->id());
        $order = new Order;
        $order->user_id = $user->id;
        $order->product_id = $data['product_id'];
        $order->quantity = $data['quantity'];
        $order->address = $data['address'];
        $order->status = 'pending';
        $order->save();

        $paymentService = new PaymentService();
        $paymentUrl = $paymentService->createPayment($order);

        event(new OrderCreated($order));

        return response()->json([
            'order' => $order,
            'payment_url' => $paymentUrl,
        ], 201);
    }
}
```

仔细观察，Pint 做了以下事情：

1. 添加了 `declare(strict_types=1);`
2. 将 import 按字母顺序排列
3. 在所有赋值运算符 `=` 周围统一添加了空格
4. 在多行数组末尾添加了 trailing comma
5. 移除了 `event()` 调用中多余的空格
6. 统一了代码缩进风格

---

### 2.2 Rector：自动化重构与语法升级引擎

#### 2.2.1 Rector 是什么

Rector 是一个极其强大的 PHP 自动化重构工具。它的核心理念是"将枯燥的、重复性的代码升级工作交给机器来做"。Rector 内置了超过 400 条重构规则，覆盖了从 PHP 5.3 到 PHP 8.4 的语法升级、框架版本迁移（如 Laravel、Symfony）、代码质量改善等多个维度。

#### 2.2.2 安装 Rector

```bash
composer require rector/rector --dev
```

初始化配置文件：

```bash
./vendor/bin/rector init
```

这会在项目根目录生成一个 `rector.php` 配置文件。

#### 2.2.3 配置详解

以下是一个面向 Laravel 项目的完整 Rector 配置：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;
use Rector\Laravel\Set\LaravelSetList;
use Rector\CodeQuality\Rector\Class_\InlineConstructorDefaultToPropertyRector;
use Rector\CodeQuality\Rector\Identical\FlipTypeControlToUseExclusiveTypeRector;
use Rector\Naming\Rector\Assign\RenameVariableToMatchMethodCallReturnTypeRector;
use Rector\DeadCode\Rector\If_\RemoveDeadInstanceOfRector;
use Rector\EarlyReturn\Rector\If_\ChangeIfElseValueAssignToEarlyReturnRector;

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
        // 跳过某些不适合自动重构的文件
        __DIR__ . '/database/migrations',
        // 如果某些文件有特殊逻辑，可以跳过
        __DIR__ . '/app/Exceptions/Handler.php',
    ])
    // 使用 PHP 8.3 的最高级别规则集
    ->withPhpSets(php83: true)
    // Laravel 框架相关的升级规则
    ->withSets([
        LaravelSetList::LARAVEL_110,
        LaravelSetList::LARAVEL_ARRAY_STR_FUNCTION_TO_STATIC_CALL,
        LaravelSetList::LARAVEL_CODE_QUALITY,
        LaravelSetList::LARAVEL_FACADE_ALIASES_TO_FULL_NAMES,
    ])
    // 代码质量规则
    ->withSets([
        SetList::CODE_QUALITY,
        SetList::DEAD_CODE,
        SetList::EARLY_RETURN,
        SetList::TYPE_DECLARATION,
        SetList::NAMING,
        SetList::PRIVATIZATION,
        SetList::CODING_STYLE,
    ])
    // 需要特别启用或禁用的规则
    ->withRules([
        InlineConstructorDefaultToPropertyRector::class,
    ])
    ->withConfiguredRule(
        FlipTypeControlToUseExclusiveTypeRector::class,
        [
            // 配置特定规则的选项
        ]
    )
    // 注册自定义规则（如果需要）
    ->withImportNames(
        removeUnusedImports: true,
        importShortClasses: false,
    );
```

#### 2.2.4 关键规则集解读

**`phpSets(php83: true)`** —— 自动将代码升级到 PHP 8.3 语法。包括但不限于：

- 将 `array()` 替换为 `[]`
- 将匿名函数替换为箭头函数（适用场景）
- 引入命名参数
- 使用 match 替代 switch
- 使用 nullsafe operator `?->`
- 使用 readonly properties
- 使用 enum 替代常量类
- 使用 constructor promotion

**`LaravelSetList::LARAVEL_110`** —— 将 Laravel 代码升级到 11.x 的最佳实践。

**`SetList::CODE_QUALITY`** —— 改善代码质量，比如内联不必要的变量、简化条件表达式等。

**`SetList::DEAD_CODE`** —— 删除死代码，包括不可达代码、未使用的参数、冗余的 instanceof 检查等。

**`SetList::EARLY_RETURN`** —— 将嵌套的 if-else 逻辑转换为 early return 模式，减少代码嵌套层级。

**`SetList::TYPE_DECLARATION`** —— 自动添加类型声明，包括参数类型、返回类型、属性类型。

#### 2.2.5 Rector 实战：Before & After

**改造前（遗留代码风格）：**

```php
<?php

namespace App\Services;

use App\Models\Product;
use App\Models\OrderItem;

class ProductService
{
    public function calculateTotal($items)
    {
        $total = 0;

        foreach ($items as $item) {
            $product = Product::find($item['product_id']);

            if ($product === null) {
                throw new \Exception('Product not found');
            }

            $quantity = (int) $item['quantity'];
            $price = (float) $product->price;
            $subtotal = $price * $quantity;

            if ($product->discount !== null) {
                $discountRate = (float) $product->discount;
                $subtotal = $subtotal * (1 - $discountRate);
            }

            $total = $total + $subtotal;
        }

        return $total;
    }

    public function getActiveProducts()
    {
        $products = Product::where('status', 'active')
            ->where('stock', '>', 0)
            ->get();

        $result = array();

        foreach ($products as $product) {
            $result[] = array(
                'id' => $product->id,
                'name' => $product->name,
                'price' => $product->price,
            );
        }

        return $result;
    }

    public function formatPrice($price, $currency = 'CNY')
    {
        if ($currency === 'CNY') {
            return '¥' . number_format($price, 2);
        } else if ($currency === 'USD') {
            return '$' . number_format($price, 2);
        } else if ($currency === 'EUR') {
            return '€' . number_format($price, 2);
        } else {
            return number_format($price, 2);
        }
    }

    public function canPurchase(Product $product, $userId)
    {
        if ($product->stock <= 0) {
            return false;
        }

        if ($product->status !== 'active') {
            return false;
        }

        return true;
    }
}
```

**Rector 重构后：**

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Product;

class ProductService
{
    public function calculateTotal(array $items): float
    {
        $total = 0.0;

        foreach ($items as $item) {
            $product = Product::find($item['product_id']);

            if ($product === null) {
                throw new \Exception('Product not found');
            }

            $quantity = (int) $item['quantity'];
            $subtotal = (float) $product->price * $quantity;

            if ($product->discount !== null) {
                $subtotal *= (1 - (float) $product->discount);
            }

            $total += $subtotal;
        }

        return $total;
    }

    public function getActiveProducts(): array
    {
        return Product::where('status', 'active')
            ->where('stock', '>', 0)
            ->get()
            ->map(fn (Product $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'price' => $product->price,
            ])
            ->toArray();
    }

    public function formatPrice(float $price, string $currency = 'CNY'): string
    {
        return match ($currency) {
            'CNY' => '¥' . number_format($price, 2),
            'USD' => '$' . number_format($price, 2),
            'EUR' => '€' . number_format($price, 2),
            default => number_format($price, 2),
        };
    }

    public function canPurchase(Product $product, int $userId): bool
    {
        if ($product->stock <= 0) {
            return false;
        }

        return $product->status === 'active';
    }
}
```

Rector 做了以下关键改造：

1. **添加了参数类型和返回类型** —— `$items` → `array $items`，`float` 返回类型
2. **使用 `match` 替代 if-else 链** —— `formatPrice` 方法变得更加简洁
3. **使用箭头函数和流式调用** —— `getActiveProducts` 使用 `map` + `fn()` 替代 foreach 循环
4. **内联不必要的变量** —— `$price` 变量被内联，`$result` 数组被消除
5. **简化赋值操作** —— `$total = $total + $subtotal` → `$total += $subtotal`
6. **移除了未使用的 import** —— `OrderItem` 被移除
7. **添加了 `declare(strict_types=1)`**

#### 2.2.6 安全运行 Rector

```bash
# 先以 dry-run 模式查看将要发生的变更
./vendor/bin/rector --dry-run

# 确认无误后，执行实际变更
./vendor/bin/rector

# 只处理特定目录
./vendor/bin/rector process app/Services

# 显示详细信息
./vendor/bin/rector --dry-run --debug
```

---

### 2.3 PHPStan：静态类型分析的终极防线

#### 2.3.1 PHPStan 是什么

PHPStan 是 PHP 生态中最强大、最流行的静态分析工具。它不需要运行代码就能发现潜在的 Bug——空指针访问、类型不匹配、未定义的属性或方法、不可达代码、死代码……几乎所有你在运行时可能遇到的错误，PHPStan 都能在开发阶段就帮你揪出来。

#### 2.3.2 安装 PHPStan

对于 Laravel 项目，推荐安装 `larastan/larastan`，它在 PHPStan 的基础上提供了对 Laravel 框架的深度支持：

```bash
composer require larastan/larastan --dev
```

#### 2.3.3 配置详解

创建 `phpstan.neon` 或 `phpstan.neon.dist` 配置文件：

```neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app

    # 分析级别：0-9，数字越大越严格
    level: 6

    # 排除的路径
    excludePaths:
        - vendor/*
        - storage/*
        - bootstrap/cache/*
        - app/Http/Middleware/VerifyCsrfToken.php

    # 忽略特定的错误（通过 ignoreErrors 配置）
    ignoreErrors:
        -
            identifier: argument.type
            message: '#Parameter .+ of .+ expects .+#'
            reportUnmatched: false
        -
            '#Access to an undefined property .+::\$#'
        -
            message: '#Call to an undefined method .+::shouldReceive\(\)#'
            reportUnmatched: false

    # 无未使用的忽略规则时抛出错误
    reportUnmatchedIgnoredErrors: false

    # 启用 Laravel 特有的规则
    checkMissingIterableValueType: true
    checkGenericClassInNonObjectType: true

    # 自动发现模型关系
    modelProperties:
        App\Models\User:
            id: int
            name: string
            email: string
            created_at: Carbon\Carbon
            updated_at: Carbon\Carbon

    # 方法扩展
    stubFiles:
        - stubs/Collection.stub
```

#### 2.3.4 严格级别说明

PHPStan 提供 0 到 9 共 10 个严格级别（以及 `max` 最高级别）：

| 级别 | 检查内容 |
|-----|---------|
| 0 | 基本检查：未定义的函数/类、错误的函数调用参数数量 |
| 1 | 可能未定义的变量、未知的魔术方法/属性 |
| 2 | 未知的方法被调用、PHPDocs 中的类型不一致 |
| 3 | 返回类型、已分配但未使用的变量 |
| 4 | 基本的死代码检查——总是 true/false 的条件 |
| 5 | 方法参数的类型检查 |
| 6 | 报告缺少的类型提示——无法推断的参数类型和返回类型 |
| 7 | `mixed` 类型的部分检查 |
| 8 | `mixed` 类型的完整检查 |
| 9 | 更严格的混合类型检查 |
| max | 包含所有实验性检查 |

**推荐：** 新项目从 level 5 或 6 开始，逐步提升到 level 8。老项目建议从 level 3 开始渐进式提升。

#### 2.3.5 PHPStan 实战：发现隐藏的 Bug

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;

class ReportService
{
    /**
     * Bug 1: 返回类型标注为 array，实际可能返回 null
     */
    public function getUserStats(int $userId): array
    {
        $user = User::find($userId);
        // 如果 user 不存在，$user 为 null，后续访问 $user->id 会抛出 TypeError
        return [
            'total_orders' => $user->orders()->count(),
            'total_spent' => $user->orders()->sum('total'),
        ];
    }

    /**
     * Bug 2: 参数类型不匹配
     */
    public function calculateDiscount(Order $order): float
    {
        $rate = $this->getDiscountRate($order->user);
        // getDiscountRate 期望 User 对象，但这里传入的可能是 null
        return $order->total * $rate;
    }

    /**
     * Bug 3: 返回类型不一致
     */
    public function getDiscountRate(User $user): float
    {
        if ($user->is_vip) {
            return 0.1;
        }
        // Bug: 漏掉了返回语句，隐式返回 null
    }

    /**
     * Bug 4: 数组键类型不安全
     */
    public function buildReport(Collection $orders): array
    {
        $report = [];
        foreach ($orders as $order) {
            $report[$order->date] = [
                'total' => $order->total,
                'count' => $order->items->count(),
            ];
        }
        return $report;
    }
}
```

PHPStan 会报告以下错误：

```
------ ------------------------------------------------
  Line   Services/ReportService.php
 ------ ------------------------------------------------
  17     Property App\Models\User::$id (int) does not
         accept null.
  27     Parameter #1 $user of method
         App\Services\ReportService::getDiscountRate()
         expects App\Models\User, App\Models\User|null
         given.
  36     Method App\Services\ReportService::
         getDiscountRate() should return float but
         return statement is missing.
 ------ ------------------------------------------------
```

#### 2.3.6 修复后的代码

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;

class ReportService
{
    /**
     * @return array{total_orders: int, total_spent: float}
     */
    public function getUserStats(int $userId): array
    {
        $user = User::findOrFail($userId);

        return [
            'total_orders' => $user->orders()->count(),
            'total_spent' => (float) $user->orders()->sum('total'),
        ];
    }

    public function calculateDiscount(Order $order): float
    {
        $rate = $this->getDiscountRate($order->user);

        return $order->total * $rate;
    }

    public function getDiscountRate(?User $user): float
    {
        if ($user === null) {
            return 0.0;
        }

        if ($user->is_vip) {
            return 0.1;
        }

        return 0.0;
    }

    /**
     * @param  Collection<int, Order>  $orders
     * @return array<string, array{total: float, count: int}>
     */
    public function buildReport(Collection $orders): array
    {
        $report = [];
        foreach ($orders as $order) {
            $report[(string) $order->date] = [
                'total' => $order->total,
                'count' => $order->items->count(),
            ];
        }

        return $report;
    }
}
```

---

## 三、三剑客联动的核心策略

### 3.1 执行顺序：为什么必须是 Pint → Rector → PHPStan

这条流水线的执行顺序绝不是随意选择的，而是经过深思熟虑的最佳实践：

**第一步：Pint（代码风格格式化）**

Pint 首先运行的原因有两个：第一，Pint 只修改代码的"外观"（空白、缩进、import 顺序等），不改变代码的语义和结构。第二，Pint 格式化后的代码具有统一的风格，这使得 Rector 在分析和重构时有一个一致的输入基准，避免因为风格差异导致的解析问题。

**第二步：Rector（自动化重构）**

Rector 在 Pint 之后运行，对格式化好的代码进行结构性改造。Rector 的改造可能引入新的代码结构——比如新的变量、新的方法调用、新的类型声明——这些都可能影响 PHPStan 的分析结果。

**第三步：PHPStan（静态分析）**

PHPStan 最后运行，分析的是 Pint 格式化 + Rector 重构后的最终代码。这样可以确保分析结果反映的是代码的最终状态，而不是中间状态。

### 3.2 冲突解决策略

三剑客联动时最常遇到的问题是"工具之间的冲突"：

**Pint 与 Rector 的冲突**

Rector 生成的代码可能不符合 Pint 的风格规则。例如，Rector 在内联变量时可能产生过长的行，或者 Rector 引入的 match 表达式缩进可能与 Pint 的预期不一致。

**解决方案：** 正因为如此，Pint 必须在 Rector 之后"二次运行"。完整的流水线实际上是：**Pint（第一次）→ Rector → Pint（第二次）→ PHPStan**。第二次 Pint 运行确保 Rector 的输出也符合代码风格规范。

但实际上，更常见的做法是：先运行 Rector 进行重构，再运行 Pint 统一格式化，最后运行 PHPStan 分析。即：**Rector → Pint → PHPStan**。不过考虑到可读性和渐进式改进，还是推荐 **Pint → Rector → Pint → PHPStan**。

**Rector 与 PHPStan 的冲突**

某些 Rector 规则可能在重构后产生 PHPStan 无法理解的代码。例如，Rector 可能将一个方法调用的结果赋给一个不同类型的变量，而 PHPStan 的类型系统对此提出了警告。

**解决方案：**

1. 为这类场景在 PHPStan 中配置 `ignoreErrors`
2. 在 Rector 中跳过特定的规则
3. 手动调整有问题的代码

**Pint 与 PHPStan 的冲突**

这种情况很少见，因为 Pint 只修改代码风格，不修改语义。但在极端情况下，Pint 的某些规则可能改变代码的结构（比如将多行代码合并为一行），从而影响 PHPStan 的分析。

### 3.3 配置协调原则

为了最大化减少冲突，三个工具的配置需要遵循以下协调原则：

1. **类型声明一致性** —— Rector 的 `TYPE_DECLARATION` 规则集会自动添加类型声明，PHPStan 的 level 设定决定了它对类型声明的要求程度。两者应该协调——如果 Rector 设定为 PHP 8.3 级别，PHPStan 的 level 就可以设得更高。

2. **import 管理一致性** —— Pint 的 `no_unused_imports` 和 Rector 的 `removeUnusedImports` 功能重叠。推荐在 Pint 中管理 import（因为它更专注于风格），在 Rector 中关闭 import 管理或设为 `importShortClasses: false`。

3. **严格类型一致性** —— Pint 的 `declare_strict_types` 规则和 Rector 的 `withPhpSets()` 都会添加 `declare(strict_types=1)`。配置一个即可，避免重复。

---

## 四、完整项目实战

### 4.1 项目初始化

假设我们有一个中等规模的 Laravel 项目，包含以下结构：

```
app/
├── Console/
├── Exceptions/
├── Http/
│   ├── Controllers/
│   │   ├── Api/
│   │   │   ├── ProductController.php
│   │   │   ├── OrderController.php
│   │   │   └── UserController.php
│   │   └── Admin/
│   │       ├── DashboardController.php
│   │       └── ReportController.php
│   ├── Middleware/
│   └── Requests/
├── Models/
│   ├── Product.php
│   ├── Order.php
│   ├── OrderItem.php
│   └── User.php
├── Services/
│   ├── ProductService.php
│   ├── OrderService.php
│   └── PaymentService.php
├── Repositories/
│   ├── ProductRepository.php
│   └── OrderRepository.php
└── Events/
    ├── OrderCreated.php
    └── PaymentCompleted.php
```

### 4.2 一站式安装

```bash
# 安装所有三个工具
composer require laravel/pint --dev
composer require rector/rector --dev
composer require larastan/larastan --dev

# 如果需要单独安装
composer require --dev laravel/pint rector/rector larastan/larastan
```

### 4.3 完整配置文件

**pint.json：**

```json
{
    "preset": "laravel",
    "rules": {
        "declare_strict_types": true,
        "array_syntax": { "syntax": "short" },
        "ordered_imports": { "sort_algorithm": "alpha" },
        "no_unused_imports": true,
        "single_quote": true,
        "trailing_comma_in_multiline": {
            "elements": ["arrays", "match", "parameters"]
        },
        "nullable_type_declaration_for_default_null_value": true,
        "class_attributes_separation": {
            "elements": {
                "method": "one",
                "property": "one"
            }
        },
        "no_superfluous_phpdoc_tags": {
            "allow_mixed": true,
            "allow_unused_params": true
        }
    },
    "exclude": ["vendor", "storage", "bootstrap/cache"]
}
```

**rector.php：**

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;
use Rector\Laravel\Set\LaravelSetList;

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
    ])
    ->withPhpSets(php83: true)
    ->withSets([
        LaravelSetList::LARAVEL_110,
        LaravelSetList::LARAVEL_CODE_QUALITY,
        SetList::CODE_QUALITY,
        SetList::DEAD_CODE,
        SetList::EARLY_RETURN,
        SetList::TYPE_DECLARATION,
    ])
    ->withImportNames(
        removeUnusedImports: false,
        importShortClasses: false,
    );
```

注意 `removeUnusedImports: false`——我们把这个职责交给 Pint 来处理。

**phpstan.neon.dist：**

```neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app

    level: 6

    excludePaths:
        - vendor/*
        - storage/*
        - bootstrap/cache/*

    ignoreErrors:
        -
            identifier: argument.type
            message: '#Parameter .+ of .+ expects .+#'
            reportUnmatched: false

    reportUnmatchedIgnoredErrors: false
```

### 4.4 Composer Scripts 集成

在 `composer.json` 中添加脚本，方便一键运行：

```json
{
    "scripts": {
        "pint": "vendor/bin/pint",
        "pint:test": "vendor/bin/pint --test",
        "rector": "vendor/bin/rector",
        "rector:dry-run": "vendor/bin/rector --dry-run",
        "phpstan": "vendor/bin/phpstan analyse --memory-limit=2G",
        "quality": [
            "@pint",
            "@rector",
            "@phpstan"
        ],
        "quality:check": [
            "@pint:test",
            "@rector:dry-run",
            "@phpstan"
        ]
    }
}
```

现在你只需要运行：

```bash
# 检查模式（不修改文件，只报告问题）
composer quality:check

# 修复模式（自动修复代码，然后分析）
composer quality
```

---

## 五、Composer Scripts 与 Makefile 集成

### 5.1 高级 Composer Scripts

上面的脚本是最基础的版本。在实际项目中，你可能需要更精细的控制：

```json
{
    "scripts": {
        "pint": "vendor/bin/pint",
        "pint:diff": "vendor/bin/pint --diff",
        "pint:test": "vendor/bin/pint --test",

        "rector": "vendor/bin/rector process",
        "rector:dry": "vendor/bin/rector process --dry-run",
        "rector:clear-cache": "vendor/bin/rector process --clear-cache",

        "phpstan": "vendor/bin/phpstan analyse --memory-limit=2G",
        "phpstan:baseline": "vendor/bin/phpstan analyse --generate-baseline --memory-limit=2G",
        "phpstan:level-8": "vendor/bin/phpstan analyse --level=8 --memory-limit=2G",

        "quality:fix": [
            "@pint",
            "@rector",
            "@pint",
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

### 5.2 Makefile 集成

对于习惯使用 Makefile 的团队，可以创建以下配置：

```makefile
.PHONY: quality quality-fix quality-check pint rector phpstan clean

# 完整的质量检查流水线
quality: pint rector phpstan

# 修复模式
quality-fix:
	@echo "🔧 Step 1/4: Running Laravel Pint (format code)..."
	@./vendor/bin/pint
	@echo "✅ Code formatting complete."
	@echo ""
	@echo "🔧 Step 2/4: Running Rector (auto-refactor)..."
	@./vendor/bin/rector process
	@echo "✅ Auto-refactoring complete."
	@echo ""
	@echo "🔧 Step 3/4: Running Laravel Pint again (reformat after Rector)..."
	@./vendor/bin/pint
	@echo "✅ Re-formatting complete."
	@echo ""
	@echo "🔍 Step 4/4: Running PHPStan (static analysis)..."
	@./vendor/bin/phpstan analyse --memory-limit=2G
	@echo ""
	@echo "🎉 Quality pipeline complete!"

# 检查模式（不修改文件）
quality-check:
	@echo "🔍 Step 1/3: Checking code style with Pint..."
	@./vendor/bin/pint --test
	@echo "✅ Code style check passed."
	@echo ""
	@echo "🔍 Step 2/3: Checking Rector changes (dry-run)..."
	@./vendor/bin/rector process --dry-run
	@echo "✅ Rector check passed."
	@echo ""
	@echo "🔍 Step 3/3: Running PHPStan static analysis..."
	@./vendor/bin/phpstan analyse --memory-limit=2G
	@echo ""
	@echo "🎉 All quality checks passed!"

# 各个工具的独立运行
pint:
	./vendor/bin/pint

rector:
	./vendor/bin/rector process

phpstan:
	./vendor/bin/phpstan analyse --memory-limit=2G

# 生成 PHPStan baseline（适用于遗留项目）
phpstan-baseline:
	./vendor/bin/phpstan analyse --generate-baseline --memory-limit=2G

# 清除所有缓存
clean:
	rm -rf .php-cs-fixer.cache
	rm -rf /tmp/rector/
	rm -rf vendor/phpstan/phpstan/tmp/
```

---

## 六、GitHub Actions CI/CD 流水线

### 6.1 完整的 GitHub Actions 配置

这是本文最核心的部分——如何将三剑客联动集成到 GitHub Actions 中。

创建 `.github/workflows/quality.yml`：

```yaml
name: Code Quality Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

# 同一分支的新 push 取消之前正在运行的工作流
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # Job 1: 代码风格检查
  pint:
    name: "🎨 Code Style (Pint)"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
          tools: composer:v2

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Run Laravel Pint
        run: vendor/bin/pint --test

  # Job 2: Rector 检查
  rector:
    name: "🔧 Code Refactoring (Rector)"
    runs-on: ubuntu-latest
    needs: pint
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
          tools: composer:v2

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Run Rector (dry-run)
        run: vendor/bin/rector process --dry-run

  # Job 3: PHPStan 静态分析
  phpstan:
    name: "🔍 Static Analysis (PHPStan)"
    runs-on: ubuntu-latest
    needs: [pint, rector]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
          tools: composer:v2

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Cache PHPStan result
        uses: actions/cache@v4
        with:
          path: tmp/phpstan
          key: ${{ runner.os }}-phpstan-${{ github.ref_name }}-${{ hashFiles('**/*.php') }}
          restore-keys: ${{ runner.os }}-phpstan-${{ github.ref_name }}-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --memory-limit=2G --error-format=github
```

### 6.2 带有 Composer 缓存优化的版本

上述配置中每个 Job 都独立安装了 Composer 依赖。我们可以进一步优化——将依赖安装提取为一个独立的 Job，并使用 Composer 缓存：

```yaml
name: Code Quality Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # 共享依赖安装
  setup:
    name: "📦 Setup Dependencies"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
          tools: composer:v2

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
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Upload vendor
        uses: actions/upload-artifact@v4
        with:
          name: vendor
          path: vendor
          retention-days: 1

  pint:
    name: "🎨 Code Style (Pint)"
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none

      - name: Download vendor
        uses: actions/download-artifact@v4
        with:
          name: vendor
          path: vendor

      - name: Run Laravel Pint
        run: vendor/bin/pint --test

  rector:
    name: "🔧 Code Refactoring (Rector)"
    runs-on: ubuntu-latest
    needs: [setup, pint]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none

      - name: Download vendor
        uses: actions/download-artifact@v4
        with:
          name: vendor
          path: vendor

      - name: Run Rector (dry-run)
        run: vendor/bin/rector process --dry-run

  phpstan:
    name: "🔍 Static Analysis (PHPStan)"
    runs-on: ubuntu-latest
    needs: [setup, pint, rector]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none

      - name: Download vendor
        uses: actions/download-artifact@v4
        with:
          name: vendor
          path: vendor

      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --memory-limit=2G --error-format=github
```

### 6.3 单 Job 优化版（适合中小型项目）

对于中小型项目，三个 Job 分开运行的开销可能大于收益。此时可以使用单 Job 方案：

```yaml
name: Code Quality Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  quality:
    name: "Code Quality Pipeline"
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP 8.3
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
          tools: composer:v2

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install Composer dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: "Step 1/4: Run Laravel Pint (check style)"
        run: vendor/bin/pint --test

      - name: "Step 2/4: Run Rector (check refactoring)"
        run: vendor/bin/rector process --dry-run

      - name: "Step 3/4: Run Laravel Pint (re-check after Rector hints)"
        run: vendor/bin/pint --test

      - name: "Step 4/4: Run PHPStan (static analysis)"
        run: vendor/bin/phpstan analyse --memory-limit=2G --error-format=github
```

### 6.4 GitLab CI 配置

如果你使用的是 GitLab，以下是等价的 `.gitlab-ci.yml` 配置：

```yaml
image: composer:2

stages:
  - style
  - refactor
  - analysis

variables:
  COMPOSER_CACHE_DIR: "$CI_PROJECT_DIR/.composer-cache"
  GIT_DEPTH: "0"

cache:
  key: "${CI_COMMIT_REF_SLUG}"
  paths:
    - .composer-cache/
    - vendor/

before_script:
  - apt-get update -yqq
  - apt-get install -yqq git libpq-dev libcurl4-gnutls-dev libicu-dev libmcrypt-dev libvpx-dev libjpeg-dev libpng-dev libxpm-dev zlib1g-dev libfreetype6-dev libxml2-dev libexpat1-dev libbz2-dev libgmp3-dev libldap2-dev unixodbc-dev libsqlite3-dev libaspedit-dev libenchant-dev libpcre3-dev
  - docker-php-ext-install mbstring
  - composer install --no-interaction --prefer-dist --no-progress

pint:
  stage: style
  script:
    - vendor/bin/pint --test

rector:
  stage: refactor
  script:
    - vendor/bin/rector process --dry-run

phpstan:
  stage: analysis
  script:
    - vendor/bin/phpstan analyse --memory-limit=2G
  allow_failure: false
```

---

## 七、渐进式采纳策略

### 7.1 对于遗留项目的一刀切困境

如果你面对的是一个已经积累了数万行代码的遗留项目，直接运行三剑客可能会产生海量的变更，让人无从下手。以下是推荐的渐进式策略。

### 7.2 阶段一：先引入 Pint

Pint 是最安全的第一步，因为它只修改代码风格，不修改语义。

```bash
# 安装 Pint
composer require laravel/pint --dev

# 第一次运行：只格式化 app 目录
./vendor/bin/pint

# 查看变更了多少文件
git diff --stat

# 提交
git add -A && git commit -m "style: apply Laravel Pint formatting"
```

### 7.3 阶段二：引入 PHPStan（带 Baseline）

```bash
# 安装 Larastan
composer require larastan/larastan --dev

# 先以低级别运行
./vendor/bin/phpstan analyse --level=3 --memory-limit=2G

# 生成 baseline（将现有错误记录为已知问题）
./vendor/bin/phpstan analyse --level=3 --generate-baseline --memory-limit=2G

# 提交 baseline
git add phpstan-baseline.neon && git commit -m "chore: add PHPStan baseline at level 3"
```

在 `phpstan.neon.dist` 中引入 baseline：

```neon
includes:
    - vendor/larastan/larastan/extension.neon
    - phpstan-baseline.neon

parameters:
    paths:
        - app
    level: 3
```

**Baseline 的核心理念：** 不要让历史问题阻碍新代码的质量提升。Baseline 记录了当前已知的所有错误，PHPStan 只会对新增或修改的代码进行严格检查。随着时间推移，逐步修复 baseline 中的问题，然后删除 baseline。

### 7.4 阶段三：引入 Rector

```bash
# 安装 Rector
composer require rector/rector --dev

# 初始化配置
./vendor/bin/rector init

# 只启用最保守的规则集
# 在 rector.php 中只启用 PHP 8.3 升级和少量代码质量规则
./vendor/bin/rector --dry-run

# 逐步引入更多规则
./vendor/bin/rector
```

### 7.5 阶段四：逐步提升 PHPStan 级别

每两周（或每个迭代）提升一个级别：

```
Level 3 → Level 4 → Level 5 → Level 6 → Level 7 → Level 8
```

每次提升级别后：

1. 运行 PHPStan 发现新问题
2. 修复这些问题（或更新 baseline）
3. 提交

### 7.6 阶段五：锁定流水线

当三个工具都稳定运行后，在 CI 中锁定流水线，禁止不合规的代码合并：

```yaml
# 在 CI 中添加分支保护规则
# main 分支：所有 Quality Jobs 必须通过才能合并 PR
```

---

## 八、高级技巧与最佳实践

### 8.1 PHPStan Baseline 管理策略

Baseline 是遗留项目的生命线。推荐的管理策略如下：

**定期清理 Baseline：**

```bash
# 重新生成 baseline（移除已修复的问题）
./vendor/bin/phpstan analyse --generate-baseline --memory-limit=2G

# 查看 baseline 中剩余的错误数量
grep -c "message:" phpstan-baseline.neon
```

**自动清理脚本：**

```bash
#!/bin/bash
# scripts/clean-baseline.sh

echo "Generating fresh PHPStan baseline..."
./vendor/bin/phpstan analyse --generate-baseline --memory-limit=2G

ERROR_COUNT=$(grep -c "message:" phpstan-baseline.neon 2>/dev/null || echo 0)

echo ""
echo "Baseline updated. Remaining known errors: $ERROR_COUNT"

if [ "$ERROR_COUNT" -eq 0 ]; then
    echo "🎉 No more baseline errors! You can remove phpstan-baseline.neon"
    rm -f phpstan-baseline.neon
fi
```

### 8.2 Rector 自定义规则编写

当内置规则无法满足需求时，可以编写自定义的 Rector 规则。

**示例：将所有 `dd()` 调用替换为 `logger()` + `throw`**

```php
<?php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Expr\FuncCall;
use PhpParser\Node\Name;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\CodeSample\CodeSample;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

class ReplaceDdWithLoggerRector extends AbstractRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            'Replace dd() calls with logger() and proper exception',
            [
                new CodeSample(
                    <<<'PHP'
dd($user);
PHP,
                    <<<'PHP'
logger()->debug('Debug dump', ['data' => $user]);
throw new \RuntimeException('Debug halt');
PHP
                ),
            ]
        );
    }

    public function getNodeTypes(): array
    {
        return [FuncCall::class];
    }

    /**
     * @param FuncCall $node
     */
    public function refactor(Node $node): ?Node
    {
        if (! $this->isName($node, 'dd')) {
            return null;
        }

        $args = $node->args;

        if (count($args) === 0) {
            return null;
        }

        // 替换为 logger()->debug(...)
        $loggerCall = new FuncCall(new Name('logger'));
        $debugCall = new Node\Expr\MethodCall($loggerCall, 'debug', [
            new Node\Arg(new Node\Scalar\String_('Debug dump')),
            new Node\Arg(new Node\Expr\Array_([
                new Node\Expr\ArrayItem(
                    $args[0]->value,
                    new Node\Scalar\String_('data')
                ),
            ])),
        ]);

        return $debugCall;
    }
}
```

在 `rector.php` 中注册：

```php
use App\Rector\ReplaceDdWithLoggerRector;

return RectorConfig::configure()
    ->withPaths([...])
    ->withRules([
        ReplaceDdWithLoggerRector::class,
    ]);
```

### 8.3 PHPStan 自定义规则扩展

PHPStan 也支持编写自定义规则。

**示例：禁止在 Controller 中直接使用 `DB::raw()`**

```php
<?php

declare(strict_types=1);

namespace App\PHPStan\Rules;

use PhpParser\Node;
use PhpParser\Node\Expr\StaticCall;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<StaticCall>
 */
class NoDirectDbRawInControllerRule implements Rule
{
    public function getNodeType(): string
    {
        return StaticCall::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        if (! $node->class instanceof Node\Name) {
            return [];
        }

        $className = $node->class->toString();
        $methodName = $node->name instanceof Node\Identifier
            ? $node->name->toString()
            : null;

        if ($className !== 'Illuminate\Support\Facades\DB' || $methodName !== 'raw') {
            return [];
        }

        // 检查是否在 Controller 中
        $currentClass = $scope->getClassReflection();
        if ($currentClass === null) {
            return [];
        }

        $parentClasses = array_map(
            fn ($class) => $class->getName(),
            $currentClass->getParents()
        );

        if (in_array('Illuminate\Routing\Controller', $parentClasses)
            || str_contains($currentClass->getName(), 'Controller')
        ) {
            return [
                'Controller 中不允许直接使用 DB::raw()，请通过 Repository 或 Service 层进行数据库操作。',
            ];
        }

        return [];
    }
}
```

在 `phpstan.neon.dist` 中注册：

```neon
services:
    -
        class: App\PHPStan\Rules\NoDirectDbRawInControllerRule
        tags:
            - phpstan.rules.rule
```

### 8.4 Pre-commit Hook 集成

为了在本地开发时也能自动运行三剑客，推荐使用 Git pre-commit hook。

使用 [CaptainHook](https://github.com/captainhookphp/captainhook) 或 [GrumPHP](https://github.com/phpro/grumphp) 来管理 Git hooks。

**GrumPHP 方式：**

```bash
composer require --dev phpro/grumphp
```

创建 `grumphp.yml`：

```yaml
grumphp:
    tasks:
        pint:
            configuration: pint.json

        phprector:
            dry_run: true

        phpstan:
            configuration: phpstan.neon.dist
            level: 6
            memory_limit: "2G"
```

**CaptainHook 方式：**

```bash
composer require --dev captainhook/captainhook
./vendor/bin/captainhook install
```

编辑 `captainhook.json`：

```json
{
    "commit-msg": [],
    "pre-commit": {
        "enabled": true,
        "actions": [
            {
                "action": "vendor/bin/pint --test",
                "options": [],
                "conditions": []
            },
            {
                "action": "vendor/bin/rector process --dry-run --config rector.php",
                "options": [],
                "conditions": []
            }
        ]
    },
    "pre-push": {
        "enabled": true,
        "actions": [
            {
                "action": "vendor/bin/phpstan analyse --memory-limit=2G",
                "options": [],
                "conditions": []
            }
        ]
    }
}
```

### 8.5 编辑器集成

**VS Code 扩展推荐：**

1. **PHP CS Fixer** —— 在保存时自动运行 Pint
2. **PHPStan** —— 实时显示 PHPStan 错误
3. **Intelephense** —— 提供智能的 PHP 代码补全（配合 PHPStan 类型信息更准确）

`.vscode/settings.json`：

```json
{
    "php-cs-fixer.executablePath": "vendor/bin/pint",
    "php-cs-fixer.onsave": true,
    "phpstan.enabled": true,
    "phpstan.paths": ["app"],
    "phpstan.level": 6,
    "[php]": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "junstyle.php-cs-fixer"
    }
}
```

**PhpStorm 配置：**

1. 在 `Settings → Tools → File Watchers` 中添加 Pint 作为 file watcher
2. 在 `Settings → PHP → Quality Tools → PHPStan` 中配置 PHPStan 路径
3. 启用 `Inspect Code` 功能

---

## 九、常见问题与故障排查

### 9.1 Pint 与 Rector "打架"

**问题描述：** Pint 格式化后，Rector 又改回去了；或者 Rector 重构后，Pint 又要改回来。形成无限循环。

**解决方案：**

1. 确认 Pint 和 Rector 的规则是否冲突。例如，Pint 的 `concat_space` 设为 `one`（空格），但 Rector 的某个规则可能生成无空格的连接。

2. 在 Pint 中排除 Rector 可能修改的文件：
```json
{
    "exclude": [
        "app/Exceptions/Handler.php"
    ]
}
```

3. 在 Rector 中跳过 Pint 已经处理的规则：
```php
->withConfiguredRule(
    SomeRector::class,
    ['skip' => true]
)
```

4. 使用"二次 Pint"策略——始终在 Rector 之后运行第二次 Pint。

### 9.2 PHPStan 内存溢出

**问题描述：** 运行 PHPStan 时报 `Allowed memory size exhausted`。

**解决方案：**

```bash
# 增加内存限制
./vendor/bin/phpstan analyse --memory-limit=4G

# 或在 phpstan.neon.dist 中配置
# parameters:
#     phpVersion:
#         max: 80300

# 使用并行分析（如果支持）
./vendor/bin/phpstan analyse -j 4 --memory-limit=4G

# 清除缓存
rm -rf tmp/phpstan
```

### 9.3 Rector 重构引入 Bug

**问题描述：** Rector 自动重构后，某些代码逻辑被意外改变。

**预防措施：**

1. **始终先用 `--dry-run` 模式** 查看变更：
```bash
./vendor/bin/rector process --dry-run
```

2. **使用 Git 分段提交：**
```bash
# 每个目录单独运行 Rector 并提交
./vendor/bin/rector process app/Models
git add -A && git commit -m "refactor: auto-upgrade Models with Rector"

./vendor/bin/rector process app/Services
git add -A && git commit -m "refactor: auto-upgrade Services with Rector"
```

3. **运行测试套件：**
```bash
# 在 Rector 运行后立即运行测试
./vendor/bin/rector process && php artisan test
```

4. **排除有复杂逻辑的文件：**
```php
// rector.php
->withSkip([
    __DIR__ . '/app/Services/ComplexBusinessLogic.php',
])
```

### 9.4 PHPStan 报错过多，无法处理

**问题描述：** 对于遗留项目，PHPStan 可能报告数百甚至数千个错误。

**解决方案：**

1. 使用 Baseline 机制（前面已详细说明）
2. 从最低级别开始，逐步提升
3. 使用 `--error-format=json` 将结果导入到工具中进行分类：
```bash
./vendor/bin/phpstan analyse --error-format=json > phpstan-result.json
```

4. 按目录逐一修复：
```bash
# 只分析特定目录
./vendor/bin/phpstan analyse app/Models --level=6
./vendor/bin/phpstan analyse app/Services --level=6
./vendor/bin/phpstan analyse app/Http/Controllers --level=6
```

### 9.5 三个工具的版本兼容性

**问题描述：** Rector 和 PHPStan 的版本可能不兼容（特别是 Rector 内部使用了 PHPStan）。

**解决方案：**

使用 Composer 的版本约束来确保兼容性：

```json
{
    "require-dev": {
        "laravel/pint": "^1.0",
        "rector/rector": "^2.0",
        "larastan/larastan": "^3.0"
    }
}
```

如果遇到版本冲突：

```bash
# 查看依赖树
composer why-not phpstan/phpstan 2.0

# 使用 Composer 的版本解析器
composer update --dry-run rector/rector
```

---

## 十、性能优化技巧

### 10.1 并行化处理

对于大型项目，可以利用工具的并行化能力：

```bash
# PHPStan 并行分析（需要 pcntl 扩展）
./vendor/bin/phpstan analyse -j 4 --memory-limit=4G

# Rector 可以按目录并行运行
# 使用 GNU Parallel
find app -type d -maxdepth 2 | parallel -j 4 ./vendor/bin/rector process {}
```

### 10.2 增量分析

```bash
# PHPStan 支持结果缓存
./vendor/bin/phpstan analyse --memory-limit=2G
# 第二次运行时会利用缓存，速度更快

# Rector 的缓存机制
# Rector 会自动缓存处理过的文件，只有变更的文件才会重新处理
```

### 10.3 CI 缓存策略

```yaml
# GitHub Actions 中的缓存策略
- name: Cache PHPStan result
  uses: actions/cache@v4
  with:
    path: |
      tmp/phpstan
      /tmp/rector
    key: ${{ runner.os }}-quality-${{ github.ref_name }}-${{ hashFiles('**/*.php') }}
    restore-keys: |
      ${{ runner.os }}-quality-${{ github.ref_name }}-
      ${{ runner.os }}-quality-
```

### 10.4 Docker 中的优化

如果你在 Docker 环境中运行 CI：

```dockerfile
FROM php:8.3-cli

RUN apt-get update && apt-get install -y \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-progress --no-scripts

COPY . .
RUN composer dump-autoload

# 安装 dev 依赖用于质量检查
RUN composer install --prefer-dist --no-progress

CMD ["sh", "-c", "vendor/bin/pint --test && vendor/bin/rector process --dry-run && vendor/bin/phpstan analyse --memory-limit=2G"]
```

---

## 十一、实际项目案例：完整的改造流程

### 11.1 背景

假设我们有一个包含 200 个 PHP 文件的 Laravel 项目，代码风格混乱，使用 PHP 7.4 语法，没有任何类型标注。我们需要将其改造为 PHP 8.3 + Laravel 11 风格，同时确保类型安全。

### 11.2 改造前的代码样本

**app/Services/OrderService.php（改造前）：**

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Events\OrderCreated;
use Illuminate\Support\Facades\DB;
use App\Exceptions\InsufficientStockException;

class OrderService
{
    protected $paymentService;

    public function __construct(PaymentService $paymentService)
    {
        $this->paymentService = $paymentService;
    }

    public function createOrder($userId, $items, $address = null)
    {
        $user = User::find($userId);

        if (!$user) {
            throw new \Exception('User not found');
        }

        DB::beginTransaction();

        try {
            $order = new Order();
            $order->user_id = $user->id;
            $order->status = 'pending';
            $order->address = $address ?? $user->default_address;
            $order->total = 0;
            $order->save();

            $total = 0;

            foreach ($items as $item) {
                $product = Product::find($item['product_id']);

                if (!$product) {
                    throw new \Exception('Product not found: ' . $item['product_id']);
                }

                if ($product->stock < $item['quantity']) {
                    throw new InsufficientStockException($product, $item['quantity']);
                }

                $orderItem = new \App\Models\OrderItem();
                $orderItem->order_id = $order->id;
                $orderItem->product_id = $product->id;
                $orderItem->quantity = $item['quantity'];
                $orderItem->price = $product->price;
                $orderItem->subtotal = $product->price * $item['quantity'];
                $orderItem->save();

                $product->stock -= $item['quantity'];
                $product->save();

                $total += $orderItem->subtotal;
            }

            $order->total = $total;
            $order->save();

            DB::commit();

            event(new OrderCreated($order));

            $paymentUrl = $this->paymentService->createPayment($order);

            return [
                'order' => $order,
                'payment_url' => $paymentUrl,
            ];
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function getOrdersByUser($userId, $status = null, $limit = 20)
    {
        $query = Order::where('user_id', $userId);

        if ($status !== null) {
            $query = $query->where('status', $status);
        }

        return $query->with('items.product')
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get();
    }

    public function cancelOrder($orderId, $reason = '')
    {
        $order = Order::find($orderId);

        if ($order === null) {
            return false;
        }

        if ($order->status !== 'pending' && $order->status !== 'paid') {
            return false;
        }

        $order->status = 'cancelled';
        $order->cancel_reason = $reason;
        $order->cancelled_at = now();
        $order->save();

        foreach ($order->items as $item) {
            $item->product->stock += $item->quantity;
            $item->product->save();
        }

        return true;
    }
}
```

### 11.3 Step 1: Pint 格式化

```bash
$ ./vendor/bin/pint app/Services/OrderService.php

  FIXED  app/Services/OrderService.php
```

**Pint 修复后：**

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Events\OrderCreated;
use App\Exceptions\InsufficientStockException;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        protected PaymentService $paymentService,
    ) {}

    public function createOrder(int $userId, array $items, ?string $address = null): array
    {
        $user = User::find($userId);

        if (! $user) {
            throw new \Exception('User not found');
        }

        DB::beginTransaction();

        try {
            $order = new Order();
            $order->user_id = $user->id;
            $order->status = 'pending';
            $order->address = $address ?? $user->default_address;
            $order->total = 0;
            $order->save();

            $total = 0;

            foreach ($items as $item) {
                $product = Product::find($item['product_id']);

                if (! $product) {
                    throw new \Exception('Product not found: ' . $item['product_id']);
                }

                if ($product->stock < $item['quantity']) {
                    throw new InsufficientStockException($product, $item['quantity']);
                }

                $orderItem = new OrderItem();
                $orderItem->order_id = $order->id;
                $orderItem->product_id = $product->id;
                $orderItem->quantity = $item['quantity'];
                $orderItem->price = $product->price;
                $orderItem->subtotal = $product->price * $item['quantity'];
                $orderItem->save();

                $product->stock -= $item['quantity'];
                $product->save();

                $total += $orderItem->subtotal;
            }

            $order->total = $total;
            $order->save();

            DB::commit();

            event(new OrderCreated($order));

            $paymentUrl = $this->paymentService->createPayment($order);

            return [
                'order' => $order,
                'payment_url' => $paymentUrl,
            ];
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function getOrdersByUser(int $userId, ?string $status = null, int $limit = 20)
    {
        $query = Order::where('user_id', $userId);

        if ($status !== null) {
            $query = $query->where('status', $status);
        }

        return $query->with('items.product')
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get();
    }

    public function cancelOrder(int $orderId, string $reason = ''): bool
    {
        $order = Order::find($orderId);

        if ($order === null) {
            return false;
        }

        if ($order->status !== 'pending' && $order->status !== 'paid') {
            return false;
        }

        $order->status = 'cancelled';
        $order->cancel_reason = $reason;
        $order->cancelled_at = now();
        $order->save();

        foreach ($order->items as $item) {
            $item->product->stock += $item->quantity;
            $item->product->save();
        }

        return true;
    }
}
```

Pint 的改动：
- 添加了 `declare(strict_types=1);`
- import 按字母顺序排列
- 使用了构造器属性提升（`protected PaymentService $paymentService`）
- 在构造函数参数末尾加了 trailing comma
- `!` 运算符后加了空格（`! $user`）
- 添加了参数类型和返回类型声明
- 运算符周围统一了空格

### 11.4 Step 2: Rector 重构

```bash
$ ./vendor/bin/rector process app/Services/OrderService.php --dry-run

 [OK] 3 changes would be made
```

```bash
$ ./vendor/bin/rector process app/Services/OrderService.php
```

**Rector 重构后：**

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Events\OrderCreated;
use App\Exceptions\InsufficientStockException;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        protected PaymentService $paymentService,
    ) {}

    public function createOrder(int $userId, array $items, ?string $address = null): array
    {
        $user = User::find($userId);

        if (! $user) {
            throw new \Exception('User not found');
        }

        DB::beginTransaction();

        try {
            $order = Order::create([
                'user_id' => $user->id,
                'status' => 'pending',
                'address' => $address ?? $user->default_address,
                'total' => 0,
            ]);

            $total = 0;

            foreach ($items as $item) {
                $product = Product::find($item['product_id']);

                if (! $product) {
                    throw new \Exception("Product not found: {$item['product_id']}");
                }

                if ($product->stock < $item['quantity']) {
                    throw new InsufficientStockException($product, $item['quantity']);
                }

                $orderItem = OrderItem::create([
                    'order_id' => $order->id,
                    'product_id' => $product->id,
                    'quantity' => $item['quantity'],
                    'price' => $product->price,
                    'subtotal' => $product->price * $item['quantity'],
                ]);

                $product->decrement('stock', $item['quantity']);

                $total += $orderItem->subtotal;
            }

            $order->update(['total' => $total]);

            DB::commit();

            event(new OrderCreated($order));

            $paymentUrl = $this->paymentService->createPayment($order);

            return [
                'order' => $order,
                'payment_url' => $paymentUrl,
            ];
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function getOrdersByUser(int $userId, ?string $status = null, int $limit = 20)
    {
        return Order::query()
            ->where('user_id', $userId)
            ->when($status !== null, fn ($query) => $query->where('status', $status))
            ->with('items.product')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
    }

    public function cancelOrder(int $orderId, string $reason = ''): bool
    {
        $order = Order::find($orderId);

        if ($order === null) {
            return false;
        }

        if ($order->status !== 'pending' && $order->status !== 'paid') {
            return false;
        }

        $order->update([
            'status' => 'cancelled',
            'cancel_reason' => $reason,
            'cancelled_at' => now(),
        ]);

        foreach ($order->items as $item) {
            $item->product->increment('stock', $item->quantity);
        }

        return true;
    }
}
```

Rector 的改动：
- 使用 `Order::create()` 替代手动赋值 + `save()`
- 使用 `$product->decrement()` 替代手动减库存
- 使用字符串插值 `"Product not found: {$item['product_id']}"` 替代字符串连接
- 使用 `Order::query()` 开头替代直接 `Order::where()`
- 使用 `when()` 条件查询替代 if 判断
- 使用 `orderByDesc()` 替代 `orderBy('created_at', 'desc')`
- 使用 `update()` 替代手动赋值 + `save()`
- 使用 `increment()` 替代手动加库存
- 移除了未使用的 import `User`

### 11.5 Step 3: Pint 二次格式化

```bash
$ ./vendor/bin/pint app/Services/OrderService.php
# 无需修改（Rector 的输出已经符合 Pint 的规范）
```

### 11.6 Step 4: PHPStan 分析

```bash
$ ./vendor/bin/phpstan analyse app/Services/OrderService.php --level=6

 3/3 [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%

 [OK] No errors
```

PHPStan 确认改造后的代码在 level 6 下没有类型安全问题。

### 11.7 最终对比总结

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 代码行数 | 112 行 | 95 行 |
| PHP 版本风格 | 7.4 | 8.3 |
| 类型标注 | 无 | 完整 |
| 代码风格 | 混乱 | PSR-12 + Laravel |
| 模型操作 | 手动赋值 | create/update/decrement |
| 条件查询 | if + query | when() 流式 |
| PHPStan 等级 | N/A | Level 6 ✅ |
| 死代码 | 多处 | 已清理 |

---

## 十二、工具对比与选型参考

### 12.1 Pint vs PHP-CS-Fixer vs ECS

| 特性 | Laravel Pint | PHP-CS-Fixer | ECS (Easy Coding Standard) |
|------|-------------|--------------|--------------------------|
| 底层实现 | PHP-CS-Fixer | 原生 | PHP-CS-Fixer + PHP_CodeSniffer |
| Laravel 支持 | ✅ 原生 | 需要配置 | 需要配置 |
| 学习曲线 | 极低 | 中等 | 中等 |
| 配置复杂度 | 极简 | 中等 | 中等 |
| 规则数量 | ~100+ | ~500+ | ~300+ |
| 推荐场景 | Laravel 项目 | 通用 PHP 项目 | PHP/Symfony 项目 |

### 12.2 Rector vs PHP-Migration

| 特性 | Rector | PHP-Migration |
|------|--------|--------------|
| 规则数量 | 400+ | ~50 |
| 框架支持 | Laravel, Symfony, PHPUnit 等 | 无 |
| 自定义规则 | ✅ 强大的框架 | ❌ 有限 |
| 社区活跃度 | 极高 | 低 |
| 推荐场景 | 所有 PHP 项目 | 简单迁移 |

### 12.3 PHPStan vs Psalm vs Phan

| 特性 | PHPStan | Psalm | Phan |
|------|---------|-------|------|
| Laravel 支持 | Larastan | laravel-psalm | 有限 |
| 严格级别 | 0-9 + max | 1-8 | 0-5 |
| 性能 | 快 | 中等 | 慢 |
| IDE 集成 | VS Code, PhpStorm | VS Code, PhpStorm | VS Code |
| 社区活跃度 | 极高 | 高 | 中 |
| 推荐场景 | 所有 PHP 项目 | 库开发 | 大型遗留项目 |

**最佳组合推荐：** Laravel 项目 → **Pint + Rector + PHPStan (Larastan)**

---

## 十三、总结与展望

### 13.1 核心要点回顾

1. **Pint 负责"看起来如何"** —— 统一代码风格，消除格式争论
2. **Rector 负责"怎么写更好"** —— 自动升级语法，消除死代码，应用最佳实践
3. **PHPStan 负责"是否安全"** —— 静态分析类型安全，预防运行时 Bug

三者缺一不可，联动使用效果远大于单独使用。

### 13.2 执行顺序铁律

```
Pint（第一次）→ Rector → Pint（第二次）→ PHPStan
```

### 13.3 渐进式采纳路径

```
阶段 1：引入 Pint → 统一代码风格
阶段 2：引入 PHPStan + Baseline → 开始类型检查
阶段 3：引入 Rector → 自动语法升级
阶段 4：提升 PHPStan 级别 → 逐步提高类型安全标准
阶段 5：CI 锁定 → 不合规代码无法合并
```

### 13.4 未来展望

PHP 生态正在快速进化。随着 PHP 8.4 及更高版本的发布，我们将会看到更多语法特性的引入——属性钩子（property hooks）、不对称可见性（asymmetric visibility）、`#[\Deprecated]` 属性等。这些新特性将为三剑客的联动带来更多可能性：

- **Pint** 将增加对新语法格式化的支持
- **Rector** 将增加将旧代码升级到 PHP 8.4+ 的规则集
- **PHPStan** 将增强对新类型系统特性的支持

持续关注这三个工具的版本更新，并定期升级你的质量治理流水线，是每个 Laravel 项目维护者的长期任务。

### 13.5 快速参考卡片

以下是一张便于收藏的快速参考卡片：

```bash
# === 安装 ===
composer require --dev laravel/pint rector/rector larastan/larastan

# === 首次初始化 ===
./vendor/bin/rector init  # 生成 rector.php

# === 日常开发（检查模式，不修改文件）===
./vendor/bin/pint --test          # 检查代码风格
./vendor/bin/rector --dry-run     # 检查可重构项
./vendor/bin/phpstan analyse      # 静态分析

# === 自动修复模式 ===
./vendor/bin/pint                 # 自动格式化
./vendor/bin/rector               # 自动重构
./vendor/bin/pint                 # 再次格式化（处理 Rector 的输出）
./vendor/bin/phpstan analyse      # 分析最终结果

# === CI 流水线 ===
# Pint --test → Rector --dry-run → PHPStan analyse
# 全部通过才能合并 PR

# === Baseline 管理（遗留项目）===
./vendor/bin/phpstan analyse --generate-baseline  # 生成 baseline
# 定期重新生成以清理已修复的问题
```

## 相关阅读

- [Distributed Tracing 实战：OpenTelemetry SDK 在 Laravel 中的端到端链路追踪](/categories/devops/Distributed-Tracing实战-OpenTelemetry-SDK在Laravel中的端到端链路追踪/) — 代码质量治理的延伸：当代码质量达标后，链路追踪是保障线上可观测性的关键手段。
- [Docker Compose Laravel 指南：PHP-FPM 8.3 + MySQL + Redis + Mailpit](/categories/devops/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/) — Pint/Rector/PHPStan 的 CI 环境通常运行在 Docker 中，本文提供完整的 Laravel Docker 开发环境配置。
- [ArgoCD GitOps 指南：Laravel CD](/categories/devops/argocd-gitops-guide-laravel-cd/) — 将代码质量流水线集成到 GitOps 持续部署流程中的完整方案。

---

感谢阅读本文。希望这套"三剑客联动"的质量治理方案能帮助你的 Laravel 项目实现代码质量的飞跃。如果你有任何问题或建议，欢迎在评论区交流讨论。

记住，好的代码质量不是一蹴而就的，而是一个持续改进的过程。从今天开始，将 Pint、Rector 和 PHPStan 引入你的项目，让自动化工具为你保驾护航。
