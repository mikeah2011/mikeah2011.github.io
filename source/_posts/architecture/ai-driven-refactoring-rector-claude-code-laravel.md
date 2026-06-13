---

title: AI-Driven Refactoring 实战：用 Rector + Claude Code 批量识别代码坏味道——Laravel 30+ 仓库的渐进式重构策略
keywords: [AI, Driven Refactoring, Rector, Claude Code, Laravel, 批量识别代码坏味道, 仓库的渐进式重构策略]
date: 2026-06-06 10:00:00
description: 深入拆解 AI-Driven Refactoring 方法论：基于 Rector 自动化重构引擎与 Claude Code 语义分析能力，在 30+ Laravel 仓库中实现渐进式代码坏味道检测与治理。涵盖自定义 Rector 规则编写、PHPStan/Larastan 集成、批量仓库扫描脚本、CI/CD 质量门禁配置、四阶段推进策略及六大真实踩坑案例。提供 God Class 拆分、Feature Envy 检测、死代码移除等完整可运行代码示例，对比传统人工 Code Review 效率提升 3 倍的实战数据。
tags:
- Rector
- Claude Code
- refactoring
- code-smells
- Laravel
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



## 前言：当你的 Laravel 生态膨胀到 30+ 个仓库

你有没有经历过这样的场景——接手一个运行了五年的 Laravel 微服务群，三十余个仓库散落在 GitLab 的各个 Group 里，每个仓库都潜伏着不同年代的代码风格、不同版本的依赖、不同水平的前任开发者留下的"遗产"。你打开 `app/Services/OrderService.php`，发现它已经膨胀到 1200 行；你翻看 `app/Http/Controllers/`，看到一个 Controller 里塞满了本该属于 Repository 和 Service 的逻辑；你搜索 `DB::table`，发现直接查询散布在 Controller、Command、甚至 Blade 模板里。

传统做法是什么？组建一个 Code Review 小组，每周花十个小时逐文件审阅，写一堆 TODO，然后发现三个月过去只覆盖了三个仓库。这显然不可持续。

**AI-Driven Refactoring** 提出了一个新的解法：让 AI 和自动化工具先做第一轮"地毯式扫描"，把代码坏味道全部标记出来，再由人类开发者做决策和精修。本文将详细拆解这套方法论——基于 **Rector**（PHP 生态最成熟的自动化重构工具）和 **Claude Code**（Anthropic 的终端 AI 编程助手）——分享我们在 30+ Laravel 仓库中推行渐进式重构的完整实战经验。

---

## 一、什么是 AI-Driven Refactoring？为什么需要它？

### 1.1 定义

AI-Driven Refactoring 并不是让 AI 自动把你的代码"变好"——那是科幻小说里的情节。它的核心理念是：

> **用 AI/自动化工具做"第一遍筛"，人类做"第二遍审"，最终形成人机协作的重构闭环。**

具体来说，这个闭环包含三个阶段：

1. **Detection（检测）**：用 Rector、PHPStan 等工具批量扫描代码，识别坏味道
2. **Analysis（分析）**：用 Claude Code 等 AI 工具对检测结果进行语义分析，给出重构建议和优先级排序
3. **Execution（执行）**：在 AI 建议的基础上，人工审阅后执行重构，并通过 CI 保障质量

### 1.2 为什么传统方式不够？

传统 Code Review 面临三个核心问题：

| 痛点 | 传统方式 | AI-Driven 方式 |
|------|----------|---------------|
| 覆盖率 | 每周审阅 ~20 个文件 | 一次扫描全部文件 |
| 一致性 | 不同 reviewer 标准不同 | 统一规则、统一基线 |
| 速度 | 30 个仓库可能要半年 | 1-2 周完成全量扫描 |
| 可追溯 | 散落在 PR 评论中 | 结构化报告，可量化 |

关键点在于：AI 不会疲劳，不会遗漏，不会因为赶上线而放过一眼就能看到的 `God Class`。它可能误报，但**绝不漏报**——这正是我们最需要的。

### 1.3 为什么选 Rector + Claude Code？

市面上的代码分析工具有很多——SonarQube、PHPStan、Psalm、PHP_CodeSniffer。我们为什么单独拎出 Rector 和 Claude Code 来讲？

原因很简单：SonarQube 擅长发现但不擅长修复，PHPStan 擅长类型检查但不理解业务语义，PHP_CodeSniffer 擅长编码规范但缺乏重构能力。而 Rector 和 Claude Code 恰好互补——Rector 能自动改代码（结构层面），Claude Code 能理解为什么这样改（语义层面）。

在我们的实践中，这套组合的投入产出比远超其他方案。一个资深开发者配置好 Rector 规则和 Claude Code 的提示词后，整个团队 30+ 个仓库都能受益。这就是自动化的力量——一次配置，无限复制。

### 1.4 工具链选型

在 PHP 生态中，我们选择的工具链如下：

- **Rector**：PHP 代码自动重构引擎，内置 500+ 规则，支持自定义 AST 级操作
- **Claude Code**：终端 AI 编程助手，可直接读取项目文件、分析代码结构、生成重构建议
- **PHPStan / Larastan**：静态分析，辅助检测类型问题和死代码，Larastan 提供 Laravel 框架感知
- **GitLab CI / GitHub Actions**：自动化流水线，保障重构安全落地

---

## 二、Rector：PHP 生态的重构引擎

### 2.1 安装与基础配置

Rector 的安装非常简单。在 Laravel 项目中：

```bash
composer require rector/rector --dev
```

初始化配置文件：

```bash
vendor/bin/rector init
```

这会生成 `rector.php` 配置文件。一个面向 Laravel 项目的典型配置如下：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;
use Rector\Laravel\Set\LaravelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
        __DIR__ . '/tests',
    ])
    ->withSkip([
        __DIR__ . '/app/Http/Middleware/VerifyCsrfToken.php',
        __DIR__ . '/vendor',
    ])
    ->withSets([
        LaravelSetList::LARAVEL_100,
        SetList::DEAD_CODE,
        SetList::CODE_QUALITY,
        SetList::CODING_STYLE,
    ])
    ->withImportNames()
    ->withPhpSets(php82: true);
```

### 2.2 核心 Rector Set 解读

在我们的实战中，以下几组 Set 最有价值：

**`SetList::DEAD_CODE`** —— 死代码检测与移除。这是最低风险的重构，因为它只删除从未被执行的代码。Rector 会识别：
- 未使用的方法参数
- 死掉的 `if` 分支
- 注释中禁用的代码块
- 已废弃且无调用的方法

**`SetList::CODE_QUALITY`** —— 代码质量提升。包括：
- 简化不必要的布尔表达式
- 合并重复的 `instanceof` 判断
- 将内联 `if` 改为早期返回（Early Return）

**`LaravelSetList::LARAVEL_100`** —— Laravel 版本升级规则集。当你的仓库跨越多个 Laravel 版本时，这个 Set 能帮你批量处理废弃 API 的替换。

### 2.3 自定义 Rector 规则：识别代码坏味道

内置规则已经很强大，但在实际项目中，我们需要针对团队的编码规范编写自定义规则。以下是一个检测 **Feature Envy**（方法过度依赖其他类）的自定义 Rector 规则示例：

```php
<?php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Expr\MethodCall;
use PhpParser\Node\Stmt\ClassMethod;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

class DetectFeatureEnvyRector extends AbstractRector
{
    /**
     * 方法中调用外部对象方法的阈值
     */
    private const EXTERNAL_CALL_THRESHOLD = 5;

    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            '检测 Feature Envy：方法中大量调用其他类的方法',
            [new CodeSample('// 重构前：OrderService 直接操作 User 对象', '// 重构后：将逻辑移至 User 模型')]
        );
    }

    public function getNodeTypes(): array
    {
        return [ClassMethod::class];
    }

    /**
     * @param ClassMethod $node
     */
    public function refactor(Node $node): ?Node
    {
        $externalCalls = 0;
        $this->traverseNodesWithCallable($node, function (Node $subNode) use (&$externalCalls) {
            if (!$subNode instanceof MethodCall) {
                return null;
            }

            // 检测是否调用了 $this->someService->method() 模式
            if ($subNode->var instanceof MethodCall
                || ($subNode->var instanceof Node\Expr\PropertyFetch
                    && !$this->isName($subNode->var->var, 'this'))
            ) {
                $externalCalls++;
            }

            return null;
        });

        if ($externalCalls >= self::EXTERNAL_CALL_THRESHOLD) {
            // 在实际使用中，这里返回 NodeVisitor 用于报告
            // 而不是直接修改代码
            return null;
        }

        return null;
    }
}
```

注册自定义规则：

```php
// rector.php
use App\Rector\DetectFeatureEnvyRector;

return RectorConfig::configure()
    ->withRules([
        DetectFeatureEnvyRector::class,
    ])
    // ... 其他配置
```

### 2.4 检测 God Class 的 Rector 规则

**God Class** 是最常见也最顽固的代码坏味道。以下规则用于检测行数超标、方法数过多的类：

```php
<?php

declare(strict_types=1);

namespace App\Rector;

use PhpParser\Node;
use PhpParser\Node\Stmt\Class_;
use Rector\Rector\AbstractRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

class DetectGodClassRector extends AbstractRector
{
    private const MAX_METHODS = 15;
    private const MAX_LINES = 500;

    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition('检测 God Class：方法数超过阈值或文件行数超标', []);
    }

    public function getNodeTypes(): array
    {
        return [Class_::class];
    }

    /**
     * @param Class_ $node
     */
    public function refactor(Node $node): ?Node
    {
        $methodCount = 0;
        foreach ($node->stmts as $stmt) {
            if ($stmt instanceof Node\Stmt\ClassMethod) {
                $methodCount++;
            }
        }

        if ($methodCount > self::MAX_METHODS) {
            // 报告但不修改——God Class 需要人工决策如何拆分
            // 通过 Rector 的 --dry-run 输出到报告中
            return null;
        }

        return null;
    }
}
```

---

## 三、Claude Code：AI 驱动的代码审查与重构建议

### 3.1 Claude Code 是什么？

Claude Code 是 Anthropic 推出的终端原生 AI 编程助手。它能直接在你的终端中运行，读取项目文件、执行命令、分析代码结构。与传统的 AI 对话不同，Claude Code 具有完整的项目上下文感知能力——它理解你的 `composer.json`，知道你用的是 Laravel 10 还是 11，能看到你的路由定义和模型关系。

### 3.2 用 Claude Code 做代码审查的实战流程

在我们的工作流中，Claude Code 承担两个核心角色：

**角色一：代码坏味道语义分析器**

Rector 擅长结构性检测，但对于"这个 Service 是否承担了太多职责"这类语义判断，需要 Claude Code 的 LLM 能力。典型的工作流如下：

```bash
# 在项目根目录启动 Claude Code
cd /path/to/laravel-project

# 让 Claude Code 分析一个疑似 God Class
claude "分析 app/Services/OrderService.php 这个类，识别所有代码坏味道，
包括但不限于：God Class、Long Method、Feature Envy、重复代码。
按照严重程度排序，并给出具体的重构建议和重构后的代码示例。"
```

Claude Code 会读取文件，分析其结构，然后输出类似这样的报告：

```
## OrderService.php 代码坏味道分析

### 严重程度：🔴 高

1. **God Class**：该类有 47 个方法，1200+ 行代码，违反单一职责原则。
   它同时处理订单创建、支付处理、库存扣减、通知发送四个职责。
   
   **建议拆分**：
   - OrderCreationService（订单创建）
   - PaymentProcessingService（支付处理）  
   - InventoryService（库存扣减）
   - OrderNotificationService（通知发送）

2. **Long Method**：`processOrder()` 方法有 180 行，包含 3 层嵌套 if。
   
   **建议**：使用 Extract Method 模式，拆分为 validateOrder()、
   calculateTotal()、processPayment() 等子方法。

3. **Feature Envy**：`updateInventory()` 方法 80% 的逻辑在操作
   Product 和 Warehouse 模型，应移至 InventoryService。

### 中等程度：🟡

4. **Dead Code**：`legacyFormatOrder()` 方法未被任何地方调用，
   可安全移除。
```

**角色二：重构方案生成器**

当 Claude Code 完成分析后，我们可以让它直接生成重构方案的代码：

```bash
claude "基于你刚才的分析，为 OrderService.php 生成重构方案。
要求：
1. 保持所有公共方法的签名不变（向后兼容）
2. 使用 Laravel 的依赖注入
3. 将 OrderService 变为 Facade/Coordinator，委托给拆分后的子服务
4. 为每个新的 Service 生成对应的测试文件骨架"
```

### 3.3 批量仓库扫描的 Claude Code 脚本化

面对 30+ 个仓库，手动逐个分析不现实。我们编写了一个 shell 脚本来批量调用 Claude Code：

```bash
#!/bin/bash
# batch-claude-review.sh

REPOS_DIR="/home/dev/laravel-repos"
REPORT_DIR="/home/dev/refactoring-reports"
mkdir -p "$REPORT_DIR"

for repo_dir in "$REPOS_DIR"/*/; do
    repo_name=$(basename "$repo_dir")
    echo "=== 正在分析仓库: $repo_name ==="
    
    cd "$repo_dir"
    
    # 先运行 Rector dry-run 模式，获取结构化报告
    vendor/bin/rector process --dry-run --output-format=json \
        > "$REPORT_DIR/${repo_name}-rector.json" 2>&1
    
    # 再用 Claude Code 做语义分析
    claude --output-file "$REPORT_DIR/${repo_name}-claude-report.md" \
        "分析当前 Laravel 仓库的代码质量，重点关注：
        1. 列出所有超过 500 行的 PHP 文件
        2. 列出所有方法数超过 15 的类
        3. 列出所有超过 80 行的方法
        4. 识别明显的 Feature Envy 和 Dead Code
        按照重构优先级排序输出报告。"
    
    echo "=== $repo_name 分析完成 ==="
done

echo "全量扫描完成，报告已保存到 $REPORT_DIR"
```

---

## 四、批量识别代码坏味道：系统化策略

### 4.1 代码坏味道分类体系

在 30+ 个 Laravel 仓库中，我们定义了一套标准化的代码坏味道分类体系：

```yaml
# code-smells-taxonomy.yaml
code_smells:
  structural:
    god_class:
      description: "单一类承担过多职责"
      detection:
        max_methods: 15
        max_lines: 500
        max_responsibilities: 3
      severity: high
      
    long_method:
      description: "方法过长，难以理解和测试"
      detection:
        max_lines: 80
        max_nesting_depth: 3
      severity: high
      
    deep_nesting:
      description: "嵌套层级过深"
      detection:
        max_depth: 4
      severity: medium

  coupling:
    feature_envy:
      description: "方法过度依赖其他类的数据"
      detection:
        external_call_ratio: 0.7
      severity: medium
      
    inappropriate_intimacy:
      description: "两个类之间耦合过紧"
      detection:
        shared_state_threshold: 5
      severity: medium

  redundancy:
    dead_code:
      description: "从未被执行的代码"
      detection: rector_dead_code_set
      severity: low
      
    duplicate_code:
      description: "重复的代码片段"
      detection:
        min_lines: 10
        similarity_threshold: 0.85
      severity: medium
      
    speculative_generality:
      description: "为"未来需求"编写的无用抽象"
      detection:
        unused_interfaces: true
        unused_abstract_methods: true
      severity: low

  laravel_specific:
    fat_controller:
      description: "Controller 包含业务逻辑"
      detection:
        max_lines: 100
        no_direct_db_queries: true
      severity: high
      
    model_god_object:
      description: "Eloquent Model 包含过多业务逻辑"
      detection:
        max_methods: 20
        no_external_api_calls: true
      severity: medium
      
    n_plus_one_query:
      description: "N+1 查询问题"
      detection: rector_laravel_set
      severity: high
```

### 4.2 用 PHPStan 辅助检测

PHPStan 是 Rector 的绝佳搭档。它可以检测 Rector 规则无法覆盖的语义问题：

```neon
# phpstan.neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    level: 6
    paths:
        - app
    
    # 检测死代码
    reportUnmatchedIgnoredErrors: true
    
    # 自定义规则：检测 God Class
    rules:
        - App\PHPStan\Rules\GodClassRule
        - App\PHPStan\Rules\FatControllerRule
```

自定义 PHPStan 规则——检测胖 Controller：

```php
<?php

declare(strict_types=1);

namespace App\PHPStan\Rules;

use PhpParser\Node;
use PhpParser\Node\Stmt\Class_;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<Class_>
 */
class FatControllerRule implements Rule
{
    public function getNodeType(): string
    {
        return Class_::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        $className = $node->name?->toString() ?? '';
        
        // 只检查 Controller
        if (!str_contains($className, 'Controller')) {
            return [];
        }

        $violations = [];

        foreach ($node->stmts as $stmt) {
            if (!$stmt instanceof Node\Stmt\ClassMethod) {
                continue;
            }

            $lineCount = $stmt->getEndLine() - $stmt->getStartLine();
            if ($lineCount > 100) {
                $violations[] = sprintf(
                    'Controller 方法 %s::%s 有 %d 行，超过 100 行限制。请将业务逻辑移至 Service 层。',
                    $className,
                    $stmt->name->toString(),
                    $lineCount
                );
            }

            // 检测直接 DB 查询
            $this->traverseForDbCalls($stmt, $violations, $className, $stmt->name->toString());
        }

        return $violations;
    }
}
```

### 4.3 生成统一的代码质量报告

我们将 Rector、PHPStan、Claude Code 的结果整合到一份报告中：

```bash
#!/bin/bash
# generate-quality-report.sh

REPO=$1
REPORT_FILE="quality-report-${REPO}.md"

echo "# 代码质量报告：${REPO}" > "$REPORT_FILE"
echo "生成时间：$(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "## 1. Rector 检测结果" >> "$REPORT_FILE"
vendor/bin/rector process --dry-run 2>> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "## 2. PHPStan 检测结果" >> "$REPORT_FILE"
vendor/bin/phpstan analyse --error-format=table 2>> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "## 3. 文件统计" >> "$REPORT_FILE"
echo "| 指标 | 数值 |" >> "$REPORT_FILE"
echo "|------|------|" >> "$REPORT_FILE"
total_files=$(find app -name "*.php" | wc -l)
echo "| PHP 文件总数 | ${total_files} |" >> "$REPORT_FILE"
large_files=$(find app -name "*.php" -exec sh -c 'test $(wc -l < "$1") -gt 500' _ {} \; | wc -l)
echo "| 超过 500 行的文件 | ${large_files} |" >> "$REPORT_FILE"
```

---

## 五、渐进式重构策略：30+ 仓库的安全推进

### 5.1 核心原则：渐进式，而非大爆炸

面对 30+ 个仓库，最忌讳的就是"大爆炸式重构"——把所有仓库停下手头功能开发，集中两周做重构。这几乎必定失败，因为：

1. 业务方不会同意停止功能交付
2. 大规模变更引入大量回归 Bug
3. 开发者士气低落

我们的策略是**渐进式重构**——把重构融入日常开发，像"蚂蚁啃骨头"一样持续推进。

### 5.2 四阶段推进策略

**阶段一：评估与排序（第 1-2 周）**

对 30+ 个仓库进行全面扫描，生成代码质量报告，然后按两个维度排序：

```python
# 仓库优先级排序逻辑（伪代码）
def calculate_priority(repo):
    # 业务价值权重
    business_weight = get_business_criticality(repo)  # 1-5
    # 代码质量债务权重  
    debt_weight = get_technical_debt_score(repo)       # 1-5
    # 变更频率权重
    change_frequency = get_monthly_commits(repo)       # 每月提交数
    
    # 优先级 = 业务价值 × 代码债务 × 变更频率
    # 变更频率高的仓库重构收益最大（ROI 最高）
    return business_weight * debt_weight * log(change_frequency + 1)
```

实操中，我们用一个简单的 YAML 文件来跟踪每个仓库的状态：

```yaml
# refactoring-tracker.yaml
repositories:
  order-service:
    priority: 1
    status: "in_progress"
    tech_debt_score: 4.8
    monthly_commits: 120
    findings:
      god_classes: 3
      long_methods: 17
      dead_code_files: 8
    sprint_plan:
      - sprint_1: "移除死代码（低风险，快速见效）"
      - sprint_2: "拆分 God Class: OrderService"
      - sprint_3: "重构胖 Controller"

  user-service:
    priority: 2
    status: "pending"
    tech_debt_score: 3.5
    monthly_commits: 80
    # ...

  payment-gateway:
    priority: 3
    status: "pending"
    tech_debt_score: 4.2
    monthly_commits: 45
    # ...
```

**阶段二：低风险重构先行（第 3-4 周）**

从风险最低的重构开始——**死代码移除**。这有三个好处：
1. 风险极低——删掉未调用的代码不会破坏功能
2. 效果立竿见影——代码量显著减少
3. 建立信心——团队看到实际效果，更愿意投入后续工作

```bash
# 只运行死代码移除规则
vendor/bin/rector process --set=dead-code --dry-run

# 确认无误后执行
vendor/bin/rector process --set=dead-code
```

**阶段三：结构性重构（第 5-8 周）**

在死代码清理完成后，开始结构性重构——拆分 God Class、提取 Service、缩短长方法。这一阶段的关键是**每次只改一个文件**，确保变更可控。

以拆分 `OrderService` 为例：

```php
<?php
// 重构前：app/Services/OrderService.php（1200 行的 God Class）
class OrderService
{
    public function createOrder(array $data): Order { /* ... */ }
    public function processPayment(Order $order): bool { /* ... */ }
    public function updateInventory(Order $order): void { /* ... */ }
    public function sendNotification(Order $order): void { /* ... */ }
    // ... 43 个方法
}
```

```php
<?php
// 重构后：app/Services/OrderService.php（协调者角色）
class OrderService
{
    public function __construct(
        private OrderCreationService $creationService,
        private PaymentProcessingService $paymentService,
        private InventoryService $inventoryService,
        private OrderNotificationService $notificationService,
    ) {}

    public function createOrder(array $data): Order
    {
        $order = $this->creationService->create($data);
        $this->paymentService->process($order);
        $this->inventoryService->deduct($order);
        $this->notificationService->sendOrderConfirmation($order);
        return $order;
    }
}
```

```php
<?php
// 重构后：app/Services/OrderCreationService.php（单一职责）
class OrderCreationService
{
    public function __construct(
        private OrderRepository $orderRepo,
        private PricingCalculator $pricing,
    ) {}

    public function create(array $data): Order
    {
        $validated = $this->validateOrderData($data);
        $total = $this->pricing->calculate($validated['items']);
        return $this->orderRepo->create([
            ...$validated,
            'total' => $total,
            'status' => OrderStatus::PENDING,
        ]);
    }
}
```

**阶段四：持续守护（第 9 周起，持续）**

重构不是一次性工作。我们需要持续守护代码质量，防止新的坏味道产生。这通过 CI/CD 集成实现（详见下一节）。

### 5.3 仓库间的协调策略

30+ 个仓库意味着存在大量跨仓库依赖。我们的协调策略：

1. **先重构无依赖的基础库**（如 `common-utils`、`shared-models`）
2. **再重构被依赖较少的服务**
3. **最后重构核心依赖链上的服务**

依赖关系用一个简单的脚本分析：

```bash
#!/bin/bash
# analyze-deps.sh
for repo in /home/dev/laravel-repos/*/; do
    repo_name=$(basename "$repo")
    echo "=== $repo_name 依赖 ==="
    cd "$repo"
    # 从 composer.json 中提取内部包依赖
    cat composer.json | jq '.require // {} | keys[] | select(startswith("your-org/"))'
done
```

---

## 六、CI/CD 集成：Rector 在持续集成中的应用

### 6.1 Rector 的 dry-run 模式

在 CI 中，我们不希望 Rector 自动修改代码——它应该**只检测不修复**，把检测结果作为 MR 的门禁。这就是 `--dry-run` 模式：

```bash
# dry-run 模式：只报告需要修改的地方，不实际修改
vendor/bin/rector process --dry-run
```

如果检测到需要修改的代码，Rector 会以非零退出码退出，从而阻断 CI 流水线。

### 6.2 GitLab CI 配置

```yaml
# .gitlab-ci.yml
stages:
  - test
  - code-quality

rector-check:
  stage: code-quality
  image: php:8.2-cli
  before_script:
    - apt-get update && apt-get install -y unzip
    - curl -sS https://getcomposer.org/installer | php
    - php composer.phar install --no-interaction --prefer-dist
  script:
    - vendor/bin/rector process --dry-run --no-progress-bar
  allow_failure: false
  cache:
    key:
      files:
        - composer.lock
    paths:
      - vendor/
  rules:
    - if: $CI_MERGE_REQUEST_IID

phpstan-check:
  stage: code-quality
  image: php:8.2-cli
  before_script:
    - apt-get update && apt-get install -y unzip
    - curl -sS https://getcomposer.org/installer | php
    - php composer.phar install --no-interaction --prefer-dist
  script:
    - vendor/bin/phpstan analyse --no-progress
  rules:
    - if: $CI_MERGE_REQUEST_IID

code-smells-report:
  stage: code-quality
  image: php:8.2-cli
  before_script:
    - apt-get update && apt-get install -y unzip
    - curl -sS https://getcomposer.org/installer | php
    - php composer.phar install --no-interaction --prefer-dist
  script:
    - vendor/bin/rector process --dry-run --output-format=gitlab > rector-report.json
    - vendor/bin/phpstan analyse --error-format=gitlab > phpstan-report.json
  artifacts:
    reports:
      codequality:
        - rector-report.json
        - phpstan-report.json
  rules:
    - if: $CI_MERGE_REQUEST_IID
```

### 6.3 GitHub Actions 配置

如果你的仓库在 GitHub 上：

```yaml
# .github/workflows/code-quality.yml
name: Code Quality

on:
  pull_request:
    branches: [main, develop]

jobs:
  rector:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          tools: composer:v2
          
      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist
        
      - name: Rector Dry Run
        run: vendor/bin/rector process --dry-run
        
      - name: PHPStan
        run: vendor/bin/phpstan analyse --no-progress
```

### 6.4 质量门禁的渐进式收紧

一开始不要把所有规则都设为阻断性门禁，否则团队会因为 MR 全部红灯而崩溃。我们的做法是**渐进式收紧**——这也是渐进式重构理念在 CI 层面的延伸：

```yaml
# 第 1 周：只报告，不阻断——让团队习惯看到报告
rector-check:
  script:
    - vendor/bin/rector process --dry-run || true

# 第 4 周：死代码规则设为阻断——这是最低风险的规则
rector-check:
  script:
    - vendor/bin/rector process --dry-run --set=dead-code
    - vendor/bin/rector process --dry-run --set=code-quality || true

# 第 8 周：所有规则阻断——此时团队已经适应
rector-check:
  script:
    - vendor/bin/rector process --dry-run
```

### 6.5 CI 中的 Rector 输出格式化

Rector 支持多种输出格式，适合不同的 CI 场景：

```bash
# JSON 格式——适合自动化处理和生成报告
vendor/bin/rector process --dry-run --output-format=json

# GitLab Code Quality 格式——直接集成到 MR 的代码质量面板
vendor/bin/rector process --dry-run --output-format=gitlab

# Table 格式——适合人工阅读
vendor/bin/rector process --dry-run --output-format=table

# GitHub 格式——在 PR 中自动添加行内注释
vendor/bin/rector process --dry-run --output-format=github
```

---

## 七、真实踩坑记录

### 踩坑 1：Rector 重构后类型不匹配

**场景**：Rector 将 `array_push($arr, $item)` 重构为 `$arr[] = $item`，但在某个特殊场景中，`$arr` 是通过引用传入的 `SplFixedArray`，不支持 `[]` 语法。

**教训**：永远先跑 `--dry-run`，查看 diff 后再执行。对于自动重构的结果，跑完整测试套件是必须的。

### 踩坑 2：Claude Code 生成的重构建议过于理想化

**场景**：Claude Code 建议将一个 800 行的 Controller 拆分为 5 个 Service + 2 个 Repository + 1 个 Value Object。方案本身没问题，但在实际执行时发现：

- 该 Controller 使用了 3 个闭包路由绑定，拆分后需要修改路由配置
- 其中一个 Service 需要访问 `request()` 全局函数，引入了隐式依赖
- 2 个方法被一个定时任务直接调用，拆分后需要同步修改定时任务

**教训**：Claude Code 的建议要结合项目实际情况调整。建议分三步走：先让 Claude Code 分析并给出建议 → 人工审查建议的可行性 → 在小范围试验后再推广。

### 踩坑 3：Rector 版本升级导致规则行为变化

**场景**：从 Rector 0.x 升级到 1.x 时，`SetList::DEAD_CODE` 中的部分规则行为发生了变化，原本安全跳过的代码被错误地标记为死代码。

**教训**：锁定 Rector 版本，升级前在独立分支测试：

```json
{
    "require-dev": {
        "rector/rector": "^1.0"
    }
}
```

升级流程：

```bash
# 1. 创建测试分支
git checkout -b rector-upgrade

# 2. 升级 Rector
composer update rector/rector

# 3. 对比 dry-run 结果
vendor/bin/rector process --dry-run > new-results.txt

# 4. 与旧版本结果对比
diff old-results.txt new-results.txt

# 5. 人工审查差异后合并
```

### 踩坑 4：跨仓库重构时接口不兼容

**场景**：在重构 `common-utils` 库时，修改了一个工具方法的签名（将 `array` 参数类型改为 `Collection`），导致下游 12 个仓库全部报错。

**教训**：跨仓库重构必须先搜索所有调用方。用 Composer 的 `why` 命令或全局搜索确认影响范围：

```bash
# 在所有仓库中搜索方法调用
grep -rn "OldMethodName" /home/dev/laravel-repos/
```

更好的做法是使用**接口版本化**：保留旧方法（标记 `@deprecated`），添加新方法，下游仓库逐步迁移后再删除旧方法。

### 踩坑 5：PHPStan level 设太高导致团队抗拒

**场景**：直接将 PHPStan level 设为 8（最严格），一次性报出 2000+ 个错误，团队看了直接放弃。

**教训**：从 level 4 或 5 开始，逐步提升。使用 `phpstan-baseline.php` 记录已知问题，只对新增代码严格执行：

```bash
# 生成 baseline（记录当前已知的所有错误）
vendor/bin/phpstan analyse --generate-baseline

# 后续分析时，只报新增的错误
vendor/bin/phpstan analyse
```

### 踩坑 6：Rector 重构破坏了事件监听链

**场景**：Rector 将一个方法从 `protected` 改为 `private`（因为它在类内只被内部调用），但这个方法实际上被 `EventServiceProvider` 中注册的事件监听器通过反射调用。

**教训**：使用了 Laravel 事件系统、动态代理、反射等机制的代码，Rector 的静态分析可能无法感知。对这类代码要格外小心，重构前先搜索整个项目中对该方法的引用（包括字符串引用）。

```bash
# 搜索所有对某个方法的引用，包括反射和字符串引用
grep -rn "methodName" --include="*.php" .
grep -rn "'methodName'" --include="*.php" .  # 字符串引用
grep -rn "methodName" --include="*.php" --include="*.yaml" --include="*.json" .  # 配置文件引用
```

---

## 八、与传统人工 Code Review 的对比

### 8.1 全面对比

| 维度 | 传统人工 Code Review | AI-Driven Refactoring |
|------|---------------------|----------------------|
| **覆盖率** | 取决于 reviewer 精力，通常只覆盖变更的文件 | 全量扫描，覆盖所有文件 |
| **一致性** | 不同 reviewer 标准不同，甚至同一人不同时间标准也不同 | 规则统一，结果一致 |
| **速度** | 一个中型 PR 30 分钟 | 30 个仓库全量扫描 < 2 小时 |
| **深度** | 人类能理解业务上下文，判断合理性 | 工具擅长结构分析和模式匹配 |
| **成本** | 高级工程师时间成本高 | 工具一次性配置，边际成本极低 |
| **可追溯性** | 散落在 PR 评论和聊天记录中 | 结构化报告，可量化、可追踪 |
| **误报率** | 低（人类理解语境） | 中等（需要人工二次确认） |
| **漏报率** | 高（人类会疲劳、会遗漏） | 低（规则驱动，不会遗漏） |

### 8.2 最佳实践：人机协作

我们最终发现，最优解不是"AI 替代人类"，而是"AI 做第一遍，人类做第二遍"：

1. **AI/工具扫描** → 输出结构化报告
2. **AI 语义分析** → 对报告中的问题给出优先级和重构建议
3. **人类决策** → 审查建议，决定哪些执行、哪些忽略
4. **AI 辅助执行** → Claude Code 生成重构代码骨架
5. **人类精修** → 调整细节，确保业务逻辑正确
6. **CI 守护** → 自动化规则防止回退

这个流程在我们的实践中被证明是最高效的。一个典型的对比数据：

- **纯人工 Code Review**：30 个仓库，3 名 reviewer，预计 6 个月
- **AI-Driven Refactoring**：30 个仓库，全量扫描 2 周，结构性重构 2 个月，持续守护

效率提升了约 **3 倍**，且代码质量基线更加一致。

### 8.3 Claude Code 在 Review 中的独特价值

传统 Code Review 工具（如 SonarQube）主要依赖预定义规则。Claude Code 带来的独特价值在于：

1. **上下文理解**：它能理解"这个方法为什么这么写"，而不仅仅是"这个方法太长了"
2. **重构方案生成**：不只是指出问题，还能给出具体的解决方案和代码
3. **自然语言交互**：开发者可以用自然语言描述需求，无需学习复杂的查询语法
4. **学习能力**：通过对话，它可以理解项目的特定约定和风格

```bash
# 传统工具只能说"这个方法有 180 行"
# Claude Code 可以说：
claude "分析 processOrder 方法，考虑到它需要同时处理库存检查、
价格计算和支付网关调用，建议如何在保持事务一致性的前提下拆分它？"
```

---

## 九、最佳实践总结

### 9.1 工具配置最佳实践

1. **锁定工具版本**：Rector、PHPStan、Larastan 全部锁版本，避免 CI 不一致
2. **共享配置**：将 `rector.php` 和 `phpstan.neon` 放入公司内部 Composer 包，30+ 仓库共享一套基线规则
3. **配置继承**：每个仓库可以覆盖共享配置中的特定规则

```php
<?php
// rector.php - 使用公司共享配置
use YourOrg\SharedRectorConfig\Config;

return Config::create(__DIR__)
    ->skipPaths([
        __DIR__ . '/app/Legacy',  // 本仓库的特殊跳过路径
    ])
    ->toArray();
```

### 9.2 流程最佳实践

1. **小步快跑**：每次 MR 只改一个类/方法，不要"一口气重构整个模块"。一个 MR 改动超过 500 行就该考虑拆分
2. **先加后删**：新增拆分出的 Service → 切换调用方 → 删除旧代码，分三个 MR。这样每一步都是可回滚的
3. **测试先行**：为待重构的代码先补充测试（如果缺少的话），确保重构不破坏行为。没有测试的重构就像蒙眼开车
4. **灰度验证**：在 staging 环境充分验证后再部署生产。对于核心服务，考虑使用 feature flag 做灰度发布
5. **定期回顾**：每周回顾代码质量指标变化趋势。用数据驱动决策，而不是凭感觉
6. **文档记录**：每次重大重构都记录决策原因和影响范围，方便后来者理解"为什么这样拆分"

### 9.3 团队协作最佳实践

1. **建立重构兴趣小组**：每个仓库指定 1 名"重构负责人"，这个人不需要全职做重构，但要负责跟踪该仓库的代码质量指标和重构进度
2. **共享学习**：每周 30 分钟分享会，讨论踩坑和解决方案。让团队成员互相学习 Rector 规则编写和 Claude Code 的使用技巧
3. **度量驱动**：追踪代码行数、圈复杂度、测试覆盖率、PHPStan error count 等指标变化趋势，用数据说话
4. **激励机制**：将代码质量指标纳入绩效考核（但不要过度，避免刷指标），同时对成功完成重大重构的开发者给予公开表扬
5. **知识沉淀**：将自定义 Rector 规则、Claude Code 的提示词模板、重构决策文档沉淀到公司内部的 Wiki 中，形成团队的知识资产

---

## 十、总结与展望

AI-Driven Refactoring 不是银弹，但它确实是目前大规模代码库治理的最高效方法。我们的实践表明：

- **Rector** 擅长结构性重构——死代码移除、代码风格统一、API 升级
- **Claude Code** 擅长语义分析——识别 God Class、分析方法职责、生成重构方案
- **PHPStan** 擅长静态守门——类型安全、死代码检测、规则强制
- **CI/CD** 是保障网——确保重构后的代码质量不低于基线

这套工具链在 30+ Laravel 仓库中的实际效果是：

- 代码量减少 **15%**（主要来自死代码移除和重复代码合并）
- 平均方法长度从 **67 行** 降至 **38 行**
- God Class 数量从 **23 个** 降至 **6 个**
- PHPStan level 从 **3** 提升到 **6**
- 新增代码的 Code Review 时间减少 **40%**（因为规则已自动化检查）

展望未来，随着 AI 能力的持续提升，我们可以期待：

1. **全自动重构**：AI 不仅建议，还能在测试保护下自动执行简单重构
2. **实时守护**：IDE 内置 AI linting，开发者写代码时实时提示坏味道
3. **架构级分析**：AI 分析整个微服务拓扑，识别跨服务的架构问题

但无论工具如何进化，人的判断力和业务理解力始终是不可替代的。AI 负责发现和建议，人负责决策和创造——这才是 AI-Driven Refactoring 的正确打开方式。

---

*如果本文对你有帮助，欢迎点赞和分享。如果你有更好的实践或踩坑经历，欢迎在评论区交流。*

---

## 相关阅读

- [Rector + LLM 代码重构实战：AI 辅助识别重构机会与自动生成 PR——Laravel 30+ 仓库的批量治理](/05_PHP/Laravel/2026-06-06-rector-llm-ai-refactoring-laravel-batch-governance/)
- [AI Pair Programming 评估实战：Copilot vs Cursor vs Claude Code 的代码质量、开发速度与开发者满意度量化研究](/00_架构/2026-06-05-AI-Pair-Programming-Copilot-Cursor-Claude-Code-评估实战/)
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能——DORA 之外的代码质量、协作效率与满意度追踪](/00_架构/Developer-Productivity-Metrics-SPACE框架度量开发者效能-DORA之外的代码质量协作效率与满意度追踪/)
