---

title: AI 驱动测试生成实战：Pest + AI 自动生成单元测试的最佳实践
keywords: [AI, Pest, 驱动测试生成实战, 自动生成单元测试的最佳实践]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-05 08:45:30
updated: 2026-05-05 08:48:08
categories:
- engineering
- testing
tags:
- AI
- Laravel
- Pest
- Testing
- CI/CD
description: 在 30+ Laravel 仓库的维护中，手写单元测试是最大的时间黑洞。本文记录如何用 Claude/GPT 结合 Pest 框架，将单元测试覆盖率从 35% 提升到 85%+ 的完整工作流，涵盖 Prompt 工程设计、AI 生成质量控制、Mock 策略、CI/CD 覆盖率门禁集成与真实踩坑复盘。
---


## 一、为什么手写测试成了瓶颈

在 KKday B2C Backend 团队维护的 30+ Laravel 仓库中，我们面临一个尴尬的现实：**Code Review 要求新功能必须附带测试，但写测试的时间往往比写功能本身还长。**

以一个典型的订单服务为例：

```php
// OrderService.php — 核心业务逻辑
class OrderService
{
    public function createOrder(CreateOrderDTO $dto): Order
    {
        // 1. 校验库存
        // 2. 计算价格（含优惠券、折扣、税费）
        // 3. 锁定库存
        // 4. 创建订单记录
        // 5. 触发支付
        // 6. 发送通知
        // 7. 记录审计日志
    }
}
```

手写这个方法的完整测试，需要覆盖：正常流程、库存不足、优惠券过期、价格计算精度、并发锁冲突、支付失败回滚、通知发送失败不影响下单…… 一个方法至少 15-20 个 test case，加上 setUp、Mock 配置，轻松 300+ 行。

**这不是技术问题，是工程效率问题。** 于是我们开始探索用 AI 自动生成测试。

## 二、整体工作流架构

经过三个月的迭代，我们形成了这样的工作流：

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI 测试生成工作流                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐     │
│  │ 源代码    │───→│ Prompt 构建器 │───→│ AI 模型           │     │
│  │ (PHP)    │    │ (Context +   │    │ Claude / GPT-4    │     │
│  │          │    │  Template)   │    │ / Cursor Agent    │     │
│  └──────────┘    └──────────────┘    └────────┬──────────┘     │
│                                                │                │
│                                    ┌───────────▼──────────┐     │
│                                    │ 生成的 Pest 测试文件  │     │
│                                    └───────────┬──────────┘     │
│                                                │                │
│       ┌────────────────────────────────────────┼──────┐         │
│       │                                        ▼      │         │
│  ┌────▼─────┐    ┌───────────┐    ┌────────────────┐  │         │
│  │ 语法检查  │───→│ 静态分析   │───→│ 测试执行        │  │         │
│  │ Pint     │    │ PHPStan   │    │ Pest + ParaTest│  │         │
│  └──────────┘    └───────────┘    └───────┬────────┘  │         │
│                                           │           │         │
│                               ┌───────────▼────────┐  │         │
│                               │ 覆盖率报告          │  │         │
│                               │ < 80% → 回退补全    │  │         │
│                               └────────────────────┘  │         │
│       └───────────────────────────────────────────────┘         │
│                                                                 │
│  ┌──────────────┐    ┌────────────────────────────────┐         │
│  │ 人工 Review   │───→│ 合并到 PR / 覆盖率门禁           │         │
│  └──────────────┘    └────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

核心原则：**AI 生成初稿，人类把关质量，CI 保证执行。**

## 三、Prompt 工程——质量的天花板

AI 生成测试的质量，90% 取决于 Prompt 的设计。我们踩了无数坑后，沉淀出这套模板：

### 3.1 基础 Prompt 模板

```markdown
## 角色
你是 Laravel 高级工程师，精通 Pest PHP 测试框架。

## 任务
为以下 PHP 类生成完整的 Pest 单元测试。

## 要求
1. 使用 Pest 语法（it/test + expect），不用 PHPUnit class
2. 必须覆盖：正常路径、边界条件、异常路径
3. Mock 所有外部依赖（数据库、队列、第三方 API）
4. 每个 test case 的命名要描述业务场景，不是技术行为
5. 使用 dataset() 减少重复代码
6. 必须包含 @covers 注解

## 上下文
- Laravel 版本：10.x
- PHP 版本：8.2
- 测试数据库：SQLite in-memory
- 已有 Factory：{列出相关 Factory}

## 目标代码
```php
{粘贴源代码}
```

## 依赖注入图
{列出构造函数注入的依赖及其接口}
```

### 3.2 踩坑 #1：不给上下文的 Prompt = 垃圾测试

最初我们只丢源代码给 AI，生成的测试长这样：

```php
// ❌ AI 生成的垃圾测试
it('can create order', function () {
    $order = Order::factory()->create();
    expect($order)->toBeInstanceOf(Order::class);
});
```

**这不叫测试，这叫 Factory 使用示范。** 它测的是 Laravel 框架本身，不是业务逻辑。

解法：**必须提供依赖注入图和业务规则摘要。** 让 AI 理解"什么该被 Mock，什么该被断言"。

### 3.3 踩坑 #2：AI 不理解"测试金字塔"

GPT 和 Claude 都倾向于生成集成测试而非单元测试。一个 Service 方法的测试，它会真的去写数据库、发队列。

```php
// ❌ AI 倾向生成的"集成测试"
it('creates order and sends notification', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stock' => 10]);
    
    $service = app(OrderService::class);
    $order = $service->createOrder(...);
    
    // 这会真的写数据库、发队列
    assertDatabaseHas('orders', [...]);
    Queue::assertPushed(SendOrderNotification::class);
});
```

解法：**在 Prompt 中明确指定 Mock 策略：**

```markdown
## Mock 规则
- Repository/Model 层：使用 Mockery::mock()，不碰数据库
- 外部 API（支付、通知）：必须 Mock，返回预设 fixture
- 队列：使用 Queue::fake()
- 事件：使用 Event::fake()
- 只有 Feature Test 才允许写 SQLite in-memory
```

## 四、实战：从 0 到 85% 覆盖率的真实路径

### 4.1 阶段一：AI 批量生成（覆盖率 35% → 65%）

我们写了一个脚本，遍历 `app/Services/` 目录，逐个文件调用 AI 生成测试：

```php
<?php
// scripts/generate-tests.php — 简化版

$servicesDir = app_path('Services');
$files = Finder::create()->in($servicesDir)->name('*.php')->files();

foreach ($files as $file) {
    $className = resolveClassName($file);
    $sourceCode = file_get_contents($file->getRealPath());
    $dependencies = extractDependencies($sourceCode);
    
    $prompt = buildPrompt(
        source: $sourceCode,
        dependencies: $dependencies,
        existingTests: findExistingTests($className),
        rules: loadTestRules()
    );
    
    $generated = callAI($prompt); // Claude API
    
    // 写入测试文件
    $testPath = mapToTestPath($file);
    File::put($testPath, $generated);
    
    // 立即跑一次，过滤语法错误
    $result = Process::run("php artisan test --filter={$testPath}");
    if ($result->failed()) {
        // 将错误信息回传给 AI 修复
        $fixed = callAI("修复以下测试的错误:\n" . $result->errorOutput());
        File::put($testPath, $fixed);
    }
}
```

**这一步的关键发现：** AI 生成的测试大约有 40% 能直接通过，30% 需要小修（类型错误、namespace 不对），30% 逻辑有误需要重写。

### 4.2 阶段二：Cursor Agent 自动修复（覆盖率 65% → 78%）

对于第一阶段生成但跑不过的测试，我们用 Cursor 的 Agent 模式做自动修复：

```markdown
# .cursorrules（项目级配置）

## 测试生成规则
- 所有测试使用 Pest 语法
- 禁止使用 Mockery::close()（Pest 自动管理）
- 使用 pest()->use(TestCase::class) 继承基础配置
- 测试文件放在 tests/Unit/ 或 tests/Feature/
- 禁止 sleep()，使用 Laravel 的 travel() 或 Carbon::setTestNow()
```

Cursor Agent 的优势是它能看到整个项目上下文，包括 Factory、Model 关联、config 文件，生成的测试更贴合项目实际。

### 4.3 阶段三：人工补全关键路径（覆盖率 78% → 85%+）

剩下的 15% 是真正的硬骨头——并发场景、状态机边界、异常链路。这些 AI 搞不定，必须人手写。

```php
// 人工补全的关键测试：并发库存扣减
it('prevents overselling under concurrent requests', function () {
    $product = Product::factory()->create(['stock' => 1]);
    
    // 模拟 10 个并发请求
    $results = collect(range(1, 10))->map(function () use ($product) {
        return cache()->lock("stock:{$product->id}", 5)->block(10, function () use ($product) {
            return app(InventoryService::class)->deduct($product->id, 1);
        });
    });
    
    $successCount = $results->filter(fn($r) => $r['success'])->count();
    expect($successCount)->toBe(1); // 只有 1 个成功
});
```

## 五、质量控制——生成 ≠ 可用

### 5.1 自动化质量门禁

我们在 CI 中加了三层检查：

```yaml
# .github/workflows/ai-test-quality.yml
name: AI Test Quality Gate

on:
  pull_request:
    paths: ['tests/**']

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      # 第一层：语法 + 代码风格
      - name: Pint Check
        run: vendor/bin/pint --test

      # 第二层：静态分析
      - name: PHPStan Level 6
        run: vendor/bin/phpstan analyse tests/ --level=6

      # 第三层：覆盖率门禁
      - name: Coverage Check
        run: |
          vendor/bin/pest --coverage --min=80
          
      # 第四层：测试不得有 skipped/incomplete
      - name: No Skipped Tests
        run: |
          COUNT=$(vendor/bin/pest --compact 2>&1 | grep -c "skipped\|TODO" || true)
          if [ "$COUNT" -gt "0" ]; then
            echo "❌ Found $COUNT skipped/TODO tests"
            exit 1
          fi
```

### 5.2 踩坑 #3：AI 生成的 Mock 过于"完美"

AI 倾向于 Mock 一切，导致测试永远通过但不测任何真实行为：

```php
// ❌ 过度 Mock——测试通过但毫无意义
it('calculates tax correctly', function () {
    $taxCalculator = Mockery::mock(TaxCalculator::class);
    $taxCalculator->shouldReceive('calculate')->andReturn(100); // 硬编码返回值
    
    $service = new OrderService($taxCalculator);
    $result = $service->calculateTotal($order);
    
    expect($result->tax)->toBe(100); // 当然是 100，你 Mock 了啊
});
```

**正确做法：Mock 外部依赖，但保留内部逻辑可测：**

```php
// ✅ Mock 外部 API，但测试内部计算逻辑
it('applies 5% tax for domestic orders', function () {
    // Mock 外部 API（税率查询服务）
    $taxApi = Mockery::mock(TaxApi::class);
    $taxApi->shouldReceive('getRate')
        ->with('TW')
        ->andReturn(new TaxRate(0.05));
    
    $service = new OrderService($taxApi);
    $result = $service->calculateTotal(
        subtotal: 1000,
        country: 'TW'
    );
    
    expect($result->tax)->toBe(50.0);       // 5% of 1000
    expect($result->total)->toBe(1050.0);
});
```

### 5.3 踩坑 #4：Dataset 生成的边界值不全

AI 生成的 `dataset()` 通常只覆盖正常值：

```php
// ❌ AI 生成的 dataset——缺少边界值
dataset('quantities', [1, 5, 10, 100]);
```

我们需要手动补充：

```php
// ✅ 完整的边界值 dataset
dataset('quantities', [
    'zero'        => [0, false],      // 零数量
    'negative'    => [-1, false],     // 负数
    'one'         => [1, true],       // 最小有效值
    'normal'      => [5, true],       // 正常值
    'max_int'     => [PHP_INT_MAX, false], // 溢出
    'float'       => [1.5, false],    // 非整数
    'string'      => ['abc', false],  // 类型错误
]);
```

## 六、三种 AI 工具的实测对比

在 30+ 仓库中，我们测试了三种 AI 工具生成 Pest 测试的效果：

| 维度 | Claude (API) | GPT-4 (API) | Cursor Agent |
|------|-------------|-------------|--------------|
| Pest 语法准确率 | 85% | 72% | 90% |
| Mock 策略合理性 | 70% | 55% | 80% |
| 边界条件覆盖 | 60% | 45% | 65% |
| 理解项目上下文 | 低（需 Prompt） | 低（需 Prompt） | 高（自动读取） |
| 单次生成速度 | 快（3-5s） | 快（3-5s） | 慢（30-60s） |
| 批量能力 | 强（API 循环） | 强（API 循环） | 弱（逐文件） |
| 修复已有测试 | 一般 | 一般 | 强 |

**我们的结论：**
- **批量初稿** → Claude API（速度快、Pest 语法好）
- **精细修复** → Cursor Agent（上下文理解强）
- **GPT-4** → 适合生成测试数据 fixture，不太适合生成测试逻辑

## 七、生产环境 CI/CD 集成

最终的 CI 流水线整合了 AI 测试生成和质量门禁：

```yaml
# .github/workflows/test-coverage.yml（关键片段）
- name: Coverage Gate
  run: |
    vendor/bin/pest --coverage --min=80 --coverage-clover=coverage.xml
    
- name: Coverage Comment
  if: github.event_name == 'pull_request'
  uses: orgoro/coverage@v3
  with:
    coverageFile: coverage.xml
    token: ${{ secrets.GITHUB_TOKEN }}
    thresholdAll: 0.80
    thresholdNew: 0.90  # 新代码要求 90%
```

关键策略：**存量代码 80%，新增代码 90%。** 这样不会因为历史债务阻塞新功能，又能逐步提高整体覆盖率。

## 八、三个月的数据复盘

| 指标 | 手写测试 | AI 辅助后 | 提升 |
|------|---------|----------|------|
| 平均写测试时间/PR | 4.2h | 1.5h | -64% |
| 测试覆盖率（均值） | 35% | 85% | +143% |
| PR 合并周期 | 2.3 天 | 1.1 天 | -52% |
| 生产 Bug 逃逸率 | 8.2% | 3.1% | -62% |
| 测试维护成本 | 高 | 中 | 人工 review 仍在 |

**最意外的收获：** AI 生成的测试虽然不完美，但它会覆盖人类"懒得写"的边界条件——空字符串、null、类型混淆。这些正是生产环境最常见的 Bug 来源。

## 九、我的建议

1. **不要指望 AI 一步到位。** 把它当初稿生成器，不是质量保证者。
2. **Prompt 是投资，不是成本。** 花一周打磨 Prompt 模板，后面每个仓库都受益。
3. **覆盖率门禁比 AI 工具更重要。** 没有 CI 门禁，AI 生成的测试也会被"下次再补"。
4. **人工 review 测试和 review 代码一样重要。** AI 生成的测试最大的风险是"看起来对但其实没测到点"。
5. **从 Service 层开始，不要从 Controller 开始。** Service 层依赖少、逻辑集中，AI 生成的成功率最高。

AI 驱动的测试生成不是银弹，但在 B2C 电商这种业务逻辑复杂、迭代速度快的场景下，它把"写测试"从痛苦变成了可接受的工作量。关键是建立**生成-审查-执行-反馈**的闭环，而不是把 AI 当作测试的替代品。

## 相关阅读

- [Pest PHP API 测试、Feature 测试、浏览器测试实战：Laravel B2C API 测试金字塔落地踩坑记录](/engineering/pest-php-apitesting-featuretesting-testingguide/)
- [PHPUnit 11.x 实战：新特性与最佳实践——从 Laravel B2C API 的断言、属性到测试架构演进踩坑记录](/engineering/phpunit-11-x-guide-best-practices/)
- [Mockery 实战：外部服务 Mock 与依赖隔离 Laravel B2C API 踩坑记录](/engineering/mockery-guide-mock/)
