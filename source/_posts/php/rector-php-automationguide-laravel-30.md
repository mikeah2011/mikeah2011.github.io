---
title: Rector-PHP-自动化代码重构与升级实战-Laravel-30仓库批量治理踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 20:15:46
updated: 2026-05-16 20:20:00
categories:
  - php
tags: [Laravel, PHP, 代码质量]
keywords: [Rector, PHP, Laravel, 自动化代码重构与升级实战, 仓库批量治理踩坑记录]
description: 在 30+ Laravel 仓库中使用 Rector PHP 实现自动化代码重构与 PHP 版本升级的完整实战经验，涵盖规则配置、自定义规则开发、CI 集成与批量执行策略，附带真实踩坑记录与解决方案。



---

# Rector PHP 自动化代码重构与升级实战：Laravel 30 仓库批量治理踩坑记录

## 一、为什么需要 Rector？

在 KKday B2C 后端团队中，我们维护着 30+ 个 Laravel/PHP 仓库。当 PHP 从 7.4 升级到 8.0、8.1、8.2 时，每个仓库都有大量的手动改动：`array_key_exists` 要改成 `??`、`strpos() !== false` 要改成 `str_contains()`、`@param` 注解要改成原生类型声明……

手动改？30 个仓库 × 每个几百处改动 = 灾难。

**Rector** 是一个 PHP 自动化重构工具，它基于 AST（抽象语法树）解析代码，然后按照预定义的规则自动修改。你可以把它理解为"PHP 的 ESLint --fix"，但能力远超 linting：它能做类型推断、跨文件分析、甚至自动添加 `declare(strict_types=1)`。

```
┌─────────────────────────────────────────────────────────────┐
│                    Rector 工作流程                            │
│                                                             │
│  PHP Source Code                                            │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ php-parser│──▶│  Rector Rules │──▶│  Modified AST     │  │
│  │ (AST解析) │    │  (规则匹配)   │    │  (修改后的AST)    │  │
│  └──────────┘    └──────────────┘    └──────────────────┘  │
│                                              │              │
│                                              ▼              │
│                                    ┌──────────────────┐    │
│                                    │  Pretty Printer   │    │
│                                    │  (代码格式化输出)  │    │
│                                    └──────────────────┘    │
│                                              │              │
│                                              ▼              │
│                                      Modified PHP Code      │
└─────────────────────────────────────────────────────────────┘
```

## 二、快速上手：Laravel 项目集成 Rector

### 2.1 安装

```bash
# 通过 Composer 安装（推荐项目级别）
composer require --dev rector/rector

# 或者全局安装
composer global require rector/rector
```

### 2.2 初始化配置

```bash
# 生成 rector.php 配置文件
vendor/bin/rector init
```

### 2.3 Laravel 项目的标准配置

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;
use Rector\TypeDeclaration\Rector\ClassMethod\ReturnTypeFromStrictTypedCallRector;
use Rector\DeadCode\Rector\BooleanAnd\RemoveAndTrueRector;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
        __DIR__ . '/tests',
    ])
    ->withSkip([
        // 跳过自动生成的文件
        __DIR__ . '/storage',
        __DIR__ . '/vendor',
        __DIR__ . '/bootstrap/cache',
        // 跳过有特殊处理的文件
        __DIR__ . '/app/Http/Middleware/TrustProxies.php',
    ])
    // PHP 版本升级规则：从当前版本逐步升到 8.2
    ->withSets([
        LevelSetList::UP_TO_PHP_82,
    ])
    // 常用规则集
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
        SetList::NAMING,
        SetList::TYPE_DECLARATION,
        SetList::PRIVATIZATION,
    ])
    // 单独启用/禁用某些规则
    ->withRules([
        ReturnTypeFromStrictTypedCallRector::class,
    ])
    ->withConfiguredRule(RemoveAndTrueRector::class, [
        // 配置选项
    ]);
```

## 三、实战一：PHP 7.4 → 8.2 批量升级

### 3.1 最有价值的自动转换

升级 30 个仓库后，我统计了 Rector 自动修复最多的几类代码：

```php
// ❌ Before: PHP 7.4 风格
$host = strpos($url, '://') !== false
    ? substr($url, 0, strpos($url, '://'))
    : $url;

$arr = ['a' => 1, 'b' => 2];
$hasKey = array_key_exists('a', $arr);

$nullable = $value === null ? 'default' : $value;

class OrderService
{
    /** @var string */
    private $status;

    /** @param array<string, mixed> $data */
    public function process(array $data): array
    {
        // ...
    }
}

// ✅ After: Rector 自动转换为 PHP 8.x 风格
$host = str_contains($url, '://')
    ? substr($url, 0, strpos($url, '://'))
    : $url;

$arr = ['a' => 1, 'b' => 2];
$hasKey = array_key_exists('a', $arr); // 或 isset($arr['a'])

$nullable = $value ?? 'default';

class OrderService
{
    private string $status;

    /** @param array<string, mixed> $data */
    public function process(array $data): array
    {
        // ...
    }
}
```

### 3.2 运行升级

```bash
# Dry-run 模式（只显示变更，不实际修改）
vendor/bin/rector process --dry-run

# 实际执行
vendor/bin/rector process

# 只处理特定目录
vendor/bin/rector process app/Services

# 并行处理（大型项目推荐）
vendor/bin/rector process --parallel
```

### 3.3 典型的升级规则效果

```
┌─────────────────────────────────────────────────────────┐
│  Rector UP_TO_PHP_82 规则覆盖范围                        │
├─────────────────────────────────────────────────────────┤
│  PHP 5.3 → 5.4:  短数组语法 []                          │
│  PHP 5.4 → 5.5:  ::class                               │
│  PHP 5.5 → 5.6:  参数展开 ...                           │
│  PHP 5.6 → 7.0:  标量类型声明、返回值类型                │
│  PHP 7.0 → 7.1:  可空类型、void 返回、类常量可见性       │
│  PHP 7.1 → 7.2:  object 类型、类型属性                   │
│  PHP 7.2 → 7.3:  尾随逗号、JSON_THROW_ON_ERROR          │
│  PHP 7.3 → 7.4:  箭头函数、类型属性、空合并赋值          │
│  PHP 7.4 → 8.0:  Named Args、Union Type、Match、         │
│                   Nullsafe Operator、str_contains/starts │
│  PHP 8.0 → 8.1:  Enum、readonly、never、Fibers           │
│  PHP 8.1 → 8.2:  readonly Class、DNF Type、null false   │
└─────────────────────────────────────────────────────────┘
```

## 四、实战二：自定义 Rector 规则

### 4.1 为什么需要自定义规则？

Rector 内置的 800+ 规则覆盖了大部分通用场景，但在实际项目中，你经常会遇到团队特有的代码规范需要自动化迁移。比如：

- 把 `Response::json()` 统一改成 `response()->json()`
- 把旧版 `kkday/log` 的调用方式迁移到新版 API
- 把魔术方法 `__get`/`__set` 替换为显式的 Getter/Setter

### 4.2 编写自定义规则

```php
<?php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Expr\StaticCall;
use PhpParser\Node\Name;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;
use Symplify\RuleDocGenerator\ValueObject\CodeSample\CodeSample;

/**
 * 将 Response::json($data, $status) 改为 response()->json($data, $status)
 */
class ResponseJsonToHelperRector extends AbstractRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            'Replace Response::json() with response()->json()',
            [
                new CodeSample(
                    'return Response::json($data, 200);',
                    'return response()->json($data, 200);'
                ),
            ]
        );
    }

    public function getNodeTypes(): array
    {
        return [StaticCall::class];
    }

    public function refactor(Node $node): ?Node
    {
        // 匹配 Response::json(...)
        if (!$this->isName($node->class, 'Illuminate\Support\Facades\Response')) {
            return null;
        }

        if (!$this->isName($node->name, 'json')) {
            return null;
        }

        // 构造 response()->json(...)
        $responseHelper = new Node\Expr\FuncCall(
            new Node\Name('response')
        );

        return new Node\Expr\MethodCall(
            $responseHelper,
            'json',
            $node->args
        );
    }
}
```

### 4.3 注册自定义规则

```php
// rector.php
use App\Rector\ResponseJsonToHelperRector;

return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withRules([
        ResponseJsonToHelperRector::class,
    ]);
```

### 4.4 测试自定义规则

Rector 提供了专门的测试框架：

```bash
composer require --dev rector/rector-testing
```

```php
<?php

declare(strict_types=1);

namespace App\Tests\Rector;

use Rector\Testing\PHPUnit\AbstractRectorTestCase;
use App\Rector\ResponseJsonToHelperRector;

class ResponseJsonToHelperRectorTest extends AbstractRectorTestCase
{
    public static function provideConfigFilePath(): string
    {
        return __DIR__ . '/config/configured_rule.php';
    }

    /**
     * @dataProvider provideData()
     */
    public function test(string $filePath): void
    {
        $this->doTestFile($filePath);
    }

    public static function provideData(): \Iterator
    {
        return self::yieldFilesFromDirectory(__DIR__ . '/Fixture');
    }
}
```

测试 Fixture 文件：

```php
<?php

// tests/Rector/Fixture/response_json.php.inc

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Response;

class OrderController
{
    public function show()
    {
        return Response::json(['order' => $this->order], 200);
    }
}

?>
-----
<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Response;

class OrderController
{
    public function show()
    {
        return response()->json(['order' => $this->order], 200);
    }
}

?>
```

## 五、实战三：30 仓库批量治理策略

### 5.1 批量执行架构

```
┌──────────────────────────────────────────────────────┐
│              30 仓库 Rector 批量治理                   │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ repo-01 │  │ repo-02 │  │ repo-03 │  ... × 30   │
│  └────┬────┘  └────┬────┘  └────┬────┘             │
│       │            │            │                    │
│       ▼            ▼            ▼                    │
│  ┌─────────────────────────────────────┐            │
│  │     Shared rector.php (公共配置)     │            │
│  │     ~/.rector/shared-rector.php     │            │
│  └─────────────────────────────────────┘            │
│                      │                               │
│                      ▼                               │
│  ┌─────────────────────────────────────┐            │
│  │     CI Pipeline (GitHub Actions)     │            │
│  │     rector --dry-run as PR check     │            │
│  └─────────────────────────────────────┘            │
└──────────────────────────────────────────────────────┘
```

### 5.2 共享配置文件

```php
<?php
// ~/.rector/shared-rector.php
// 被所有仓库的 rector.php require

declare(strict_types=1);

use Rector\Config\RectorConfig;

return static function (RectorConfig $rectorConfig): void {
    $rectorConfig->withSkip([
        __DIR__ . '/storage',
        __DIR__ . '/vendor',
        __DIR__ . '/bootstrap/cache',
        // 通用跳过规则
        '*/migrations/*',
        '*/_ide_helper*',
    ]);

    $rectorConfig->withParallel();
    $rectorConfig->withImportNames();
    $rectorConfig->withPhpSets(php82: true);
};
```

每个仓库的 `rector.php`：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;

return static function (RectorConfig $rectorConfig): void {
    // 加载共享配置
    require_once getenv('HOME') . '/.rector/shared-rector.php';

    $rectorConfig->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/tests',
    ]);

    // 仓库特有的规则
    $rectorConfig->withSets([
        \Rector\Set\ValueObject\SetList::DEAD_CODE,
    ]);
};
```

### 5.3 批量执行脚本

```bash
#!/bin/bash
# scripts/rector-batch.sh

REPOS=(
    "repo-b2c-api"
    "repo-member-service"
    "repo-search-service"
    "repo-recommend-service"
    "repo-payment-gateway"
    # ... 更多仓库
)

MODE="${1:---dry-run}"  # 默认 dry-run
RESULTS_FILE="rector-results-$(date +%Y%m%d).log"

echo "=== Rector 批量执行 ===" | tee "$RESULTS_FILE"
echo "模式: $MODE" | tee -a "$RESULTS_FILE"
echo "时间: $(date)" | tee -a "$RESULTS_FILE"

for repo in "${REPOS[@]}"; do
    REPO_PATH="$HOME/GitHub/$repo"
    echo "" | tee -a "$RESULTS_FILE"
    echo ">>> 处理: $repo" | tee -a "$RESULTS_FILE"

    if [ ! -d "$REPO_PATH" ]; then
        echo "  [SKIP] 目录不存在" | tee -a "$RESULTS_FILE"
        continue
    fi

    cd "$REPO_PATH" || continue

    # 确保依赖是最新的
    composer install --quiet 2>/dev/null

    # 执行 Rector
    START_TIME=$(date +%s)
    vendor/bin/rector process $MODE \
        --no-ansi \
        --output-format=json \
        > "rector-output.json" 2>&1
    EXIT_CODE=$?
    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))

    if [ $EXIT_CODE -eq 0 ]; then
        echo "  [OK] 耗时: ${ELAPSED}s" | tee -a "$RESULTS_FILE"
    else
        echo "  [FAIL] 退出码: $EXIT_CODE, 耗时: ${ELAPSED}s" | tee -a "$RESULTS_FILE"
    fi
done

echo "" | tee -a "$RESULTS_FILE"
echo "=== 完成 ===" | tee -a "$RESULTS_FILE"
```

### 5.4 CI 集成：GitHub Actions

```yaml
# .github/workflows/rector.yml
name: Rector Check

on:
  pull_request:
    paths:
      - 'app/**'
      - 'tests/**'

jobs:
  rector:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          tools: composer

      - name: Install Dependencies
        run: composer install --no-progress

      - name: Run Rector (dry-run)
        run: vendor/bin/rector process --dry-run --no-ansi
```

## 六、踩坑记录

### 坑 1：Rector 修改了不该改的代码

**现象**：运行 Rector 后，某些业务逻辑被"优化"掉了，比如 `if ($a === true)` 被简化为 `if ($a)`，但在某些场景下 `$a` 可能是 `int` 类型，语义完全不同。

**解决**：对特定规则做精细化配置：

```php
->withConfiguredRule(
    \Rector\CodeQuality\Rector\If_\SimplifyIfReturnBoolRector::class,
    [
        // 禁用某些过于激进的简化
    ]
)
->withSkip([
    // 跳过特定文件
    __DIR__ . '/app/Services/LegacyPaymentService.php',
]);
```

### 坑 2：Laravel Facade 的类型推断失败

**现象**：Rector 无法正确推断 `Cache::get()`、`DB::table()` 等 Facade 调用的返回类型，导致错误的类型声明。

**解决**：安装 Laravel Rector 扩展 + IDE Helper：

```bash
composer require --dev driftingly/rector-laravel
```

```php
// rector.php
use RectorLaravel\Set\LaravelSetList;

return RectorConfig::configure()
    ->withSets([
        LaravelSetList::LARAVEL_100,
    ]);
```

### 坑 3：`declare(strict_types=1)` 导致类型错误暴露

**现象**：Rector 自动添加了 `declare(strict_types=1)`，但原有代码中有隐式类型转换（如 `string` 传给 `int` 参数），运行时直接报 `TypeError`。

**解决**：分两步走：

```bash
# 第一步：先不加 strict_types，只做语法升级
vendor/bin/rector process --no-strict-types

# 第二步：手动检查 + 修复类型问题后再加
vendor/bin/rector process
```

### 坑 4：并行模式下的内存溢出

**现象**：30 个仓库中，有 3 个大型仓库（>5000 个 PHP 文件）在并行模式下 OOM。

**解决**：

```php
// rector.php
return RectorConfig::configure()
    ->withParallel(
        maxNumberOfProcess: 4,        // 限制并行进程数
        jobSize: 50,                   // 每批处理文件数
        memoryLimit: '1G'              // 内存限制
    );
```

### 坑 5：Git diff 冲突管理

**现象**：Rector 修改了大量文件，与正在开发的分支产生大量 merge conflict。

**解决**：制定严格的执行策略：

```bash
# 1. 从 main 创建 rector 分支
git checkout -b refactor/rector-php82 main

# 2. 执行 Rector
vendor/bin/rector process

# 3. 分模块提交
git add app/Services && git commit -m "refactor: Rector PHP 8.2 - Services"
git add app/Http && git commit -m "refactor: Rector PHP 8.2 - HTTP"
git add app/Models && git commit -m "refactor: Rector PHP 8.2 - Models"

# 4. 立即合并到 main（避免长期分支冲突）
```

## 七、最佳实践总结

```
┌─────────────────────────────────────────────────────────────┐
│              Rector 落地 Checklist                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  □ 1. 先 dry-run，确认变更范围再执行                         │
│  □ 2. 逐版本升级（7.4→8.0→8.1→8.2），不要跳级              │
│  □ 3. 每次升级后跑完整测试套件                               │
│  □ 4. 使用 .gitignore 排除 rector cache                     │
│  □ 5. CI 中只跑 dry-run，不在 PR 中自动修改                 │
│  □ 6. 共享配置避免 30 个仓库各自为政                         │
│  □ 7. 分模块提交，不要一个 commit 改 3000 个文件             │
│  □ 8. 跳过 migrations、_ide_helper 等自动生成文件           │
│  □ 9. 安装对应的框架扩展（rector-laravel）                  │
│  □ 10. 升级完成后锁定 Rector 版本，避免 CI 随版本漂移        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 八、Rector vs 其他工具对比

| 维度 | Rector | PHP-CS-Fixer | PHPStan | Psalm |
|------|--------|-------------|---------|-------|
| 核心能力 | AST 级代码重构 | 代码风格修复 | 静态分析（只读） | 静态分析（只读） |
| 能否修改代码 | ✅ 自动修改 | ✅ 自动修改 | ❌ 只报告 | ❌ 只报告 |
| PHP 版本升级 | ✅ 核心场景 | ❌ | ⚠️ 检测但不修复 | ⚠️ 检测但不修复 |
| 自定义规则 | ✅ PHP 编写 | ✅ PHP 编写 | ❌ 配置级 | ❌ 配置级 |
| 与 CI 集成 | dry-run 检查 | --diff 检查 | 直接检查 | 直接检查 |
| 推荐组合 | 与 PHPStan 配合 | 与 Rector 配合 | 与 Rector 配合 | 替代 PHPStan |

**我的推荐工作流**：

```
代码提交 → PHP-CS-Fixer（风格）→ Rector（重构）→ PHPStan（类型检查）→ Pest（测试）
```

Rector 不是银弹，但在管理大量 PHP 仓库的升级和重构时，它几乎是唯一能规模化解决问题的工具。关键在于：**不要指望一次跑完所有规则，而是分阶段、分模块、逐步推进。** 先用 dry-run 看清楚变更，再分批执行，配合完整的测试覆盖，才能安全地完成 30 个仓库的 PHP 版本升级。
