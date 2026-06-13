---
title: Laravel 项目技术债治理实战：Rector 批量重构 + PHPStan 渐进式升级 + CI 门禁——30+ 仓库的代码质量治理方法论
keywords: [Laravel, Rector, PHPStan, CI, 项目技术债治理实战, 批量重构, 渐进式升级, 门禁, 仓库的代码质量治理方法论, 工程化]
date: 2026-06-09
categories:
  - engineering
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Rector
  - PHPStan
  - 技术债
  - CI
  - 代码质量
  - 重构
  - 静态分析
  - PHP
  - engineering
description: 当你的 Laravel 项目从 1 个仓库膨胀到 30+，技术债不再是「以后再改」能解决的。本文以 KKday B2C 后端团队的真实经历为背景，完整拆解一套可落地的技术债治理方案：用 Rector 做自动化批量重构，用 PHPStan 做渐进式静态分析升级，用 CI 门禁做质量兜底。方案核心不在工具本身，而在「怎么让 30 个仓库同时推进还不翻车」的工程方法论。
---


# Laravel 项目技术债治理实战：Rector 批量重构 + PHPStan 渐进式升级 + CI 门禁——30+ 仓库的代码质量治理方法论

## 前言：技术债的真实成本

技术债不是代码风格不好看，而是**团队为了赶进度做出的结构性妥协**。这些妥协在 1 个仓库的时候还能忍，但当项目从 1 个 Laravel API 膨胀到 30+ 个微服务、BFF、工具库的时候，问题就爆发了：

- **新人不敢改老代码**——不知道改了会不会炸，没有测试兜底
- **PHP 版本升级卡住**——某个仓库还在用 PHP 7.4 的废弃语法，升级到 8.x 直接报错
- **依赖版本锁定**——Laravel 8 升 9 升 10，每个仓库的升级成本都不一样
- **代码风格不统一**——30 个仓库 30 种写法，Code Review 效率极低
- **CI 形同虚设**——跑个 `phpcs` 就算「质量门禁」了

我们团队经历过这些，然后花了几个月时间建立了一套治理方案。本文不是「Rector 和 PHPStan 怎么装」的教程，而是**「30+ 仓库怎么同时推进技术债治理还不影响业务迭代」的方法论**。

## 一、治理策略：分层推进，不搞一刀切

### 1.1 技术债分层模型

我们把技术债分成四层，每层的治理工具和优先级不同：

```
┌─────────────────────────────────────┐
│  第四层：架构债（最难治）              │
│  - 过度耦合、缺少抽象、循环依赖        │
│  - 治理方式：人工重构 + 架构评审       │
├─────────────────────────────────────┤
│  第三层：逻辑债（PHPStan Level 6+）    │
│  - 类型不安全、null 未处理、接口滥用    │
│  - 治理方式：PHPStan 渐进式升级        │
├─────────────────────────────────────┤
│  第二层：语法债（Rector 批量修复）      │
│  - 废弃语法、过时写法、不一致的代码风格  │
│  - 治理方式：Rector 自动重构           │
├─────────────────────────────────────┤
│  第一层：格式债（最低成本）             │
│  - 缩进、空格、换行、注释格式          │
│  - 治理方式：PHP-CS-Fixer 一键格式化   │
└─────────────────────────────────────┘
```

**关键原则：先治低成本、高覆盖面的债，再逐步深入。**

### 1.2 仓库分组与优先级

30+ 仓库不可能同时推进，我们按风险和收益分组：

| 分组 | 特征 | 优先级 | 治理深度 |
|------|------|--------|---------|
| 核心库 | 被多个服务依赖的公共包 | 最高 | PHPStan Level 8 |
| BFF 层 | 面向前端的 API 聚合层 | 高 | PHPStan Level 6 |
| 微服务 | 独立业务域的服务 | 中 | PHPStan Level 4-5 |
| 工具脚本 | 定时任务、数据迁移 | 低 | PHPStan Level 2-3 |

## 二、Rector：自动化批量重构

### 2.1 为什么选 Rector

Rector 的核心价值不是「帮你重构」，而是**「把重构规则代码化」**。你定义一组规则，Rector 会扫描整个代码库并自动应用修改。这意味着：

- 重构是**可重复**的——跑一次和跑十次结果一样
- 重构是**可审计**的——每个变更都有对应的规则
- 重构是**可回滚**的——`git revert` 就行

### 2.2 安装与基础配置

```bash
# 在项目根目录
composer require rector/rector --dev

# 生成配置文件
vendor/bin/rector init
```

生成的 `rector.php` 基础配置：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;

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
    ])
    // PHP 版本升级规则集：从 7.4 升到 8.2
    ->withPhpSets(php82: true)
    // Laravel 特定规则集
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
    ]);
```

### 2.3 Laravel 专用规则配置

Rector 有专门的 Laravel 规则集，我们根据项目实际选择性启用：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;
use Rector\DeadCode\Rector\ClassMethod\RemoveUnusedPrivateMethodParameterRector;
use Rector\CodeQuality\Rector\If_\SimplifyIfReturnBoolRector;
use Rector\CodeQuality\Rector\BooleanAnd\BooleanAndInstanceOfToInstanceofRector;

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
        // 排除第三方包的发布配置
        __DIR__ . '/config/flare.php',
    ])
    ->withPhpSets(php82: true)
    ->withSets([
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
        SetList::CODING_STYLE,
    ])
    // 针对性跳过某些规则
    ->withRules([
        // 启用：简化 if-return-bool
        SimplifyIfReturnBoolRector::class,
        // 启用：合并 instanceof 判断
        BooleanAndInstanceOfToInstanceofRector::class,
    ])
    ->withConfiguredRule(RemoveUnusedPrivateMethodParameterRector::class, [
        // 保留带下划线前缀的参数（Laravel 约定）
        'private_method' => true,
    ]);
```

### 2.4 实战：PHP 7.4 → 8.2 语法批量升级

这是我们在一个 B2C API 仓库里跑 Rector 的真实案例。先用 dry-run 模式预览：

```bash
# 只看会改什么，不实际修改
vendor/bin/rector process --dry-run

# 输出示例：
# 1) app/Services/OrderService.php
#    ---------- begin diff ----------
#    -        $result = $this->calculateTotal($items, $couponId ?? null);
#    +        $result = $this->calculateTotal($items, $couponId);
#
#    -        if (($status !== null) && ($status !== '')) {
#    +        if ($status !== null && $status !== '') {
#    ---------- end diff ----------
#
# [OK] 47 files would be changed (128 changes)
```

确认没问题后执行：

```bash
vendor/bin/rector process --dry-run --output-format=json > rector-preview.json
# 人工审查 JSON 输出
vendor/bin/rector process
```

**常见的自动修复类型：**

```php
// 修复前：PHP 7.4 写法
class OrderService
{
    private string $prefix;

    public function __construct()
    {
        $this->prefix = config('order.prefix') ?? 'ORD';
    }

    public function getOrderId(int $id): string
    {
        return sprintf('%s-%06d', $this->prefix, $id);
    }
}

// 修复后：PHP 8.2 写法（Rector 自动应用）
class OrderService
{
    public function __construct(
        private readonly string $prefix = 'ORD',
    ) {}

    public function getOrderId(int $id): string
    {
        return sprintf('%s-%06d', $this->prefix, $id);
    }
}
```

### 2.5 自定义 Rector 规则

有些团队特定的规范，Rector 没有内置规则，需要自定义：

```php
<?php

// rector-rules/NoArrayAccessOnEloquentCollection.php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Expr\ArrayDimFetch;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

final class NoArrayAccessOnEloquentCollection extends AbstractRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            '禁止用数组下标访问 Eloquent Collection，改用 first/last/find',
            []
        );
    }

    public function getNodeTypes(): array
    {
        return [ArrayDimFetch::class];
    }

    public function refactor(Node $node): ?Node
    {
        // 检查是否对 Eloquent Collection 做数组访问
        if (!$this->isName($node->var, 'items') &&
            !$this->isObjectType($node->var, \Illuminate\Database\Eloquent\Collection::class)) {
            return null;
        }

        // 只警告，不自动修复（需要人工判断用 first 还是 find）
        return null;
    }
}
```

在 `rector.php` 中注册：

```php
->withRules([
    \App\Rector\NoArrayAccessOnEloquentCollection::class,
])
```

### 2.6 渐进式策略：不要一次跑完

**这是最重要的经验：永远不要在 30 个仓库上一次性跑完所有 Rector 规则。**

我们的分阶段策略：

```
阶段 1（第 1 周）：只跑 DEAD_CODE
  - 移除未使用的 use、变量、方法参数
  - 风险最低，改动最大，团队信心建设

阶段 2（第 2-3 周）：跑 CODE_QUALITY
  - 简化 if-return、合并条件、移除冗余代码
  - 需要 Code Review，但大部分是安全的

阶段 3（第 4-5 周）：跑 PHP 版本升级规则
  - PHP 7.4 → 8.0 的语法变更（match、named args、nullsafe operator）
  - 这一步需要特别小心，可能有行为变更

阶段 4（持续）：跑 CODING_STYLE
  - 代码风格统一，配合 PHP-CS-Fixer 使用
```

## 三、PHPStan：渐进式静态分析升级

### 3.1 为什么需要 PHPStan

Rector 解决的是「代码怎么写」的问题，PHPStan 解决的是「代码逻辑对不对」的问题。

PHPStan 有 10 个 Level，从 Level 0（最宽松）到 Level 10（最严格）：

| Level | 检查内容 | 适合场景 |
|-------|---------|---------|
| 0 | 基本语法错误、未知类、未定义方法 | 老项目首次接入 |
| 1-2 | 方法参数类型、返回类型 | 快速获得收益 |
| 3-4 | 未定义变量、dead code | 大多数项目的目标 |
| 5-6 | 参数类型严格、null 安全 | 中型项目的理想目标 |
| 7-8 | 泛型、高级类型推导 | 核心库、公共包 |
| 9-10 | 极致类型安全 | 几乎不可能达到（开玩笑的） |

### 3.2 安装与基础配置

```bash
composer require phpstan/phpstan --dev
composer require phpstan/phpstan-laravel --dev  # Laravel 扩展
```

创建 `phpstan.neon`：

```neon
includes:
    - vendor/phpstan/phpstan-laravel/extension.neon

parameters:
    level: 0
    paths:
        - app
        - config
        - database
        - routes
    excludePaths:
        - vendor
        - storage
        - bootstrap/cache
    ignoreErrors:
        # 暂时忽略第三方包的类型问题
        - '#Call to an undefined method Illuminate\\#'
    checkMissingIterableValueType: false
    reportUnmatchedIgnoredErrors: false
```

### 3.3 渐进式升级：从 Level 0 到 Level 6

**关键策略：先用 Level 0 跑通全量代码，再逐级升级。**

```bash
# Level 0：先让 CI 能跑通
vendor/bin/phpstan analyse --level=0

# 逐级升级
vendor/bin/phpstan analyse --level=1
# 如果报错太多，先修复再升级
```

### 3.4 处理 Level 升级时的错误

Level 1 到 Level 2 升级时，最常见的错误是「方法参数类型不匹配」：

```php
// PHPStan Level 2 报错：
// Parameter #1 $id of method OrderService::find() expects int, string given.

// 修复前
public function getOrderByCode(string $code): Order
{
    return $this->orderService->find($code); // 报错：find() 期望 int
}

// 修复后：在方法入口做类型转换
public function getOrderByCode(string $code): Order
{
    $id = (int) $code;
    if ($id <= 0) {
        throw new InvalidArgumentException('Invalid order code');
    }
    return $this->orderService->find($id);
}
```

Level 4 到 Level 5 的典型问题：**null 安全**

```php
// PHPStan Level 5 报错：
// Cannot call method getName() on User|null.

// 修复前
public function getUserName(int $id): string
{
    $user = User::find($id);
    return $user->getName(); // 可能 NPE
}

// 修复后
public function getUserName(int $id): string
{
    $user = User::find($id);
    return $user?->getName() ?? 'Unknown';
}
```

### 3.5 使用 Baseline 忽略存量错误

这是**渐进式治理的核心技巧**：对于已有代码中的存量错误，用 baseline 文件记录，新代码必须通过检查。

```bash
# 生成 baseline（记录当前所有已知错误）
vendor/bin/phpstan analyse --generate-baseline

# 生成 phpstan-baseline.neon 文件，包含所有已知错误
```

在 `phpstan.neon` 中引入 baseline：

```neon
includes:
    - phpstan-baseline.neon
    - vendor/phpstan/phpstan-laravel/extension.neon

parameters:
    level: 5  # 可以放心升级 level 了
    paths:
        - app
    # baseline 中的错误会被忽略，只有新代码需要通过 Level 5
```

**升级流程：**

```bash
# 1. 升级 level
# 修改 phpstan.neon 中的 level: 4 → level: 5

# 2. 重新生成 baseline（包含新 level 下的存量错误）
vendor/bin/phpstan analyse --generate-baseline

# 3. 新增的 baseline 条目就是需要修复的存量债务
# 用 git diff phpstan-baseline.neon 看新增了哪些

# 4. 逐步减少 baseline 中的条目
# 每次 Sprint 预留 20% 时间清理 baseline
```

### 3.6 自定义 PHPStan 规则

Laravel 项目中，我们定义了一些团队规范：

```php
<?php

// phpstan-rules/NoGlobalQueryScopeRule.php

declare(strict_types=1);

namespace App\PHPStan\Rules;

use PhpParser\Node;
use PhpParser\Node\Expr\MethodCall;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<MethodCall>
 */
final class NoGlobalQueryScopeRule implements Rule
{
    public function getNodeType(): string
    {
        return MethodCall::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        if (!$node->name instanceof Node\Identifier) {
            return [];
        }

        $methodName = $node->name->name;

        // 禁止在 Controller 中使用 global scope
        if ($this->isControllerScope($scope) && $this->isGlobalScopeMethod($methodName)) {
            return [
                'Controller 中禁止使用 global scope，请在 Service 层处理',
            ];
        }

        return [];
    }

    private function isControllerScope(Scope $scope): bool
    {
        $classReflection = $scope->getClassReflection();
        if ($classReflection === null) {
            return false;
        }
        return str_contains($classReflection->getName(), 'Controller');
    }

    private function isGlobalScopeMethod(string $method): bool
    {
        return in_array($method, ['withoutGlobalScope', 'withoutGlobalScopes', 'withGlobalScope']);
    }
}
```

在 `phpstan.neon` 中注册：

```neon
services:
    -
        class: App\PHPStan\Rules\NoGlobalQueryScopeRule
        tags:
            - phpstan.rules.rule
```

## 四、CI 门禁：把质量检查固化到流水线

### 4.1 CI 流水线设计

这是整个方案的**兜底层**——不管开发者本地跑没跑 Rector/PHPStan，CI 都会检查。

```yaml
# .github/workflows/code-quality.yml
name: Code Quality

on:
  pull_request:
    branches: [main, develop, release/*]
  push:
    branches: [main]

jobs:
  code-quality:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql, redis
          coverage: none

      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist --optimize-autoloader

      - name: PHP-CS-Fixer
        run: vendor/bin/php-cs-fixer fix --dry-run --diff --format=txt

      - name: Rector Dry Run
        run: vendor/bin/rector process --dry-run

      - name: PHPStan
        run: vendor/bin/phpstan analyse --no-progress --error-format=github
```

### 4.2 GitLab CI 版本

```yaml
# .gitlab-ci.yml
stages:
  - lint
  - analysis
  - test

php-cs-fixer:
  stage: lint
  script:
    - vendor/bin/php-cs-fixer fix --dry-run --diff
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

rector:
  stage: lint
  script:
    - vendor/bin/rector process --dry-run
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

phpstan:
  stage: analysis
  script:
    - vendor/bin/phpstan analyse --no-progress --error-format=gitlab
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

phpunit:
  stage: test
  script:
    - php artisan test --parallel
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

### 4.3 分支保护与质量门禁

在 GitHub/GitLab 中配置分支保护规则：

```bash
# GitHub CLI 配置分支保护
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["code-quality"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1}'
```

**关键配置：**
- `strict: true`——PR 必须基于最新 main 分支
- `contexts: ["code-quality"]`——CI 必须通过才能合并
- `enforce_admins: true`——管理员也不能绕过

### 4.4 Pre-commit Hook：本地拦截

在开发者本地也配置拦截，避免提交明显问题：

```bash
# 安装 husky 或 lefthook
composer require --dev lefthook-php/lefthook

# lefthook.yml
pre-commit:
  parallel: true
  commands:
    php-cs-fixer:
      glob: "*.php"
      run: vendor/bin/php-cs-fixer fix {staged_files} && git add {staged_files}
    rector:
      glob: "*.php"
      run: vendor/bin/rector process {staged_files} --dry-run
```

## 五、多仓库协同：Monorepo 工具链

### 5.1 问题：30 个仓库怎么统一配置

每个仓库都有自己的 `rector.php`、`phpstan.neon`、`.php-cs-fixer.php`，如果每个仓库独立维护，配置漂移是必然的。

**解决方案：用 Composer 包统一管理配置。**

创建一个内部 Composer 包 `kkday/code-quality-config`：

```json
{
    "name": "kkday/code-quality-config",
    "description": "KKday 统一代码质量配置",
    "type": "library",
    "require": {
        "php": "^8.2",
        "rector/rector": "^1.0",
        "phpstan/phpstan": "^1.10",
        "phpstan/phpstan-laravel": "^1.4",
        "friendsofphp/php-cs-fixer": "^3.30"
    },
    "autoload": {
        "psr-4": {
            "KKday\\CodeQuality\\": "src/"
        }
    }
}
```

### 5.2 共享 Rector 配置

```php
<?php

// kkday/code-quality-config/src/Rector/BaseConfig.php

declare(strict_types=1);

namespace KKday\CodeQuality\Rector;

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\SetList;

final class BaseConfig
{
    public static function apply(RectorConfig $rectorConfig): void
    {
        $rectorConfig
            ->withSkip([
                __DIR__ . '/../../../vendor',
                __DIR__ . '/../../../storage',
                __DIR__ . '/../../../bootstrap/cache',
            ])
            ->withPhpSets(php82: true)
            ->withSets([
                SetList::DEAD_CODE,
                SetList::CODE_QUALITY,
            ]);
    }
}
```

项目中的 `rector.php` 变得极简：

```php
<?php

// 项目根目录 rector.php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use KKday\CodeQuality\Rector\BaseConfig;

return static function (RectorConfig $rectorConfig): void {
    // 应用团队统一配置
    BaseConfig::apply($rectorConfig);

    // 项目特定路径
    $rectorConfig->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
        __DIR__ . '/tests',
    ]);
};
```

### 5.3 共享 PHPStan 配置

```neon
# kkday/code-quality-config/phpstan-base.neon
includes:
    - vendor/phpstan/phpstan-laravel/extension.neon

parameters:
    level: 5
    checkMissingIterableValueType: false
    reportUnmatchedIgnoredErrors: false
    treatPhpDocTypesAsCertain: false
```

项目中的 `phpstan.neon`：

```neon
includes:
    - vendor/kkday/code-quality-config/phpstan-base.neon
    - phpstan-baseline.neon

parameters:
    paths:
        - app
    excludePaths:
        - app/Console/Commands/DevOnly*
```

## 六、踩坑记录

### 6.1 Rector 的行为变更陷阱

Rector 不只是改语法，有时候会改行为：

```php
// 修复前：null 合并
$value = isset($data['key']) ? $data['key'] : 'default';

// Rector 修复后：null 合并运算符
$value = $data['key'] ?? 'default';
```

看起来一样？注意 `isset` 和 `??` 对 `null` 值的处理：

```php
$data = ['key' => null];

// isset 返回 false
$result1 = isset($data['key']) ? $data['key'] : 'default'; // 'default'

// ?? 也返回 default（因为值是 null）
$result2 = $data['key'] ?? 'default'; // 'default'

// 但是：
$data = ['key' => ''];

// isset 返回 true
$result1 = isset($data['key']) ? $data['key'] : 'default'; // ''

// ?? 返回 ''
$result2 = $data['key'] ?? 'default'; // ''

// 这里行为一致，但如果有 array_key_exists 的场景就不同了
```

**教训：Rector dry-run 的输出必须人工审查，特别是涉及条件判断和类型转换的改动。**

### 6.2 PHPStan Baseline 膨胀

Baseline 文件会随着时间膨胀，如果不主动清理，它就变成了一个「已知问题清单」而不是「待办清单」。

```bash
# 定期检查 baseline 大小
wc -l phpstan-baseline.neon

# 如果超过 500 行，说明债务在积累
# 设置目标：每个 Sprint 减少 10%
```

我们的做法是给 baseline 条目加注释，标注优先级：

```neon
# phpstan-baseline.neon
# TODO: P0 - 下个 Sprint 必须修复
parameters:
    ignoreErrors:
        -
            identifier: method.notFound
            message: '#Call to an undefined method App\\Models\\Order::scopeActive\(\)#'
            count: 1
            reportUnmatched: false
```

### 6.3 第三方包的类型问题

Laravel 生态中，很多包的 PHPStan 类型定义不完整。常见问题：

```php
// 报错：Parameter #1 $callback of method Collection::map() expects callable, Closure given.
// 这不是你的代码问题，是 Collection 的类型定义不准确

// 解决方案 1：在 phpstan.neon 中忽略
ignoreErrors:
    - '#Parameter #1 \$callback of method Illuminate\\Support\\Collection::map\(\)#'

// 解决方案 2：安装 Larastan（已经处理了大部分 Laravel 类型）
composer require phpstan/phpstan-laravel --dev
```

### 6.4 Rector 与 PHPStan 的冲突

Rector 的某些修改可能会让 PHPStan 报新错误：

```php
// Rector 把 if-return 改成了 early return
// 但 PHPStan 可能会发现新的类型问题

// 解决方案：先跑 Rector，再跑 PHPStan，修复 PHPStan 发现的问题
vendor/bin/rector process
vendor/bin/phpstan analyse
```

### 6.5 CI 超时问题

30+ 仓库的 CI 运行时间是个大问题。优化策略：

```yaml
# 只检查变更的文件
- name: Changed Files
  id: changed-files
  uses: tj-actions/changed-files@v41
  with:
    files: |
      **/*.php

- name: PHPStan (Changed Only)
  if: steps.changed-files.outputs.any_changed == 'true'
  run: |
    CHANGED_FILES="${{ steps.changed-files.outputs.all_changed_files }}"
    vendor/bin/phpstan analyse $CHANGED_FILES --no-progress
```

## 七、度量与持续改进

### 7.1 建立度量体系

没有度量就没有改进。我们跟踪这些指标：

```bash
# 生成代码质量报告
vendor/bin/phpstan analyse --error-format=json | jq '.totals'

# 输出：
# {
#   "errors": 0,
#   "file_errors": 127
# }

# 跟踪 baseline 变化趋势
git log --oneline --all -- phpstan-baseline.neon | wc -l
```

### 7.2 可视化报告

在 CI 中生成报告并推送到仪表盘：

```yaml
# 在 CI 中生成报告
- name: Generate Report
  run: |
    vendor/bin/phpstan analyse --error-format=json > phpstan-report.json
    vendor/bin/rector process --dry-run --output-format=json > rector-report.json

- name: Upload to Dashboard
  run: |
    curl -X POST "$DASHBOARD_URL/api/reports" \
      -H "Authorization: Bearer $TOKEN" \
      -F "phpstan=@phpstan-report.json" \
      -F "rector=@rector-report.json"
```

### 7.3 渐进式目标设定

```
Month 1-2：所有仓库接入 Rector DEAD_CODE 规则
Month 3-4：所有仓库接入 PHPStan Level 2 + baseline
Month 5-6：核心库升级到 PHPStan Level 5
Month 7-8：BFF 层升级到 PHPStan Level 4
Month 9+：持续清理 baseline，逐步提高 level
```

## 八、总结

技术债治理不是一次性工程，而是**持续的工程实践**。核心要点：

1. **分层治理**——先格式，再语法，再逻辑，最后架构
2. **渐进式推进**——用 baseline 保护存量，用 level 升级推动增量
3. **自动化兜底**——CI 门禁确保质量不退化
4. **配置统一**——用 Composer 包管理共享配置，避免漂移
5. **度量驱动**——跟踪指标，设定目标，持续改进

30+ 仓库的技术债治理听起来很吓人，但只要策略正确、工具到位、节奏可控，它是可以被工程化解决的。关键是**不要追求完美，要追求持续改进**。

从今天开始，选一个仓库，装上 Rector，跑 `--dry-run`，看看你的代码有多少「隐藏的改进空间」。这一步迈出去，后面就顺了。
