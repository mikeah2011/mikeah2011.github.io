---
title: OpenAI Codex CLI 实战：自动化代码生成与重构踩坑记录
date: 2026-05-17 05:45:09
updated: 2026-05-17 05:47:02
categories:
  - macOS
  - AI 工具
tags: [AI, Laravel]
description: OpenAI Codex CLI 是 2025 年开源的终端 AI 编程代理，本文从安装配置到实际项目中批量重构 Laravel 代码、生成测试、处理遗留代码的真实踩坑记录，对比 Claude Code 的使用差异。
---

> 一句话总结：**Codex CLI 是 OpenAI 开源的终端 AI 编程代理，适合批量代码生成和自动化重构场景，在 "读上下文 → 规划 → 执行" 的工作流中表现出色，但需要理解它的沙箱机制和审批模式才能安全高效地使用。**

## 1. 为什么需要 Codex CLI？

在 KKday B2C 后端团队，30+ 个 Laravel 仓库维护的日常痛点：

- **批量重构**：PHP 8.1 Enum 替换魔术字符串，涉及 30 个仓库、数千处修改
- **测试生成**：新接手的仓库覆盖率 0%，需要快速补齐核心路径测试
- **代码规范化**：PHPStan Level 8 升级，大量类型声明需要补充

Claude Code CLI 已经能做这些事，但 Codex CLI 有几个独特优势：
- **完全开源**（Apache 2.0），可以审计每行代码
- **沙箱执行**：文件操作在沙箱中完成，不会误删生产配置
- **自动审批模式**：适合批量任务，减少手动确认

## 2. 安装与基础配置

### 2.1 安装

```bash
# 系统要求：Node.js 22+
node --version  # v22.14.0

# 通过 npm 全局安装
npm install -g @openai/codex

# 验证安装
codex --version
```

### 2.2 认证配置

```bash
# 方式一：环境变量（推荐 CI 场景）
export OPENAI_API_KEY="sk-proj-xxxx"

# 方式二：配置文件（推荐本地开发）
# ~/.codex/config.toml
cat << 'EOF' > ~/.codex/config.toml
model = "o4-mini"
approval_mode = "suggest"  # suggest | auto-edit | full-auto
EOF
```

### 2.3 三种审批模式

这是 Codex CLI 最核心的设计，也是最容易踩坑的地方：

```mermaid
graph TD
    A[Codex CLI 审批模式] --> B[suggest 模式]
    A --> C[auto-edit 模式]
    A --> D[full-auto 模式]
    
    B -->|"只建议，不动文件"| B1[最安全，适合探索]
    C -->|"自动写文件，执行命令需确认"| C1[日常开发推荐]
    D -->|"全部自动执行"| D2[批量任务，需谨慎]
```

| 模式 | 文件读写 | 命令执行 | 适用场景 |
|------|---------|---------|---------|
| `suggest` | 只读 | 只建议 | 探索代码库、代码审查 |
| `auto-edit` | 自动写入 | 需确认 | 日常开发、单文件修改 |
| `full-auto` | 自动写入 | 自动执行 | 批量重构、CI 流水线 |

## 3. 实战：Laravel 仓库批量重构

### 3.1 场景：用 Enum 替换魔术字符串

30 个仓库中，状态码硬编码到处都是：

```php
// 重构前：魔术字符串散落在各处
if ($order->status === '1') {
    // 待支付
} elseif ($order->status === '2') {
    // 已支付
} elseif ($order->status === '3') {
    // 已取消
}
```

用 Codex CLI 批量处理：

```bash
# 进入项目目录
cd ~/GitHub/kkday/order-service

# 使用 auto-edit 模式，让 Codex 自动修改文件
codex --approval-mode auto-edit \
    "扫描整个项目，将所有订单状态的魔术字符串（'1','2','3','4','5'）替换为 OrderStatus Enum。
     创建 app/Enums/OrderStatus.php，使用 PHP 8.1 的 backed enum。
     保持所有现有逻辑不变，只做等价替换。"
```

Codex CLI 的执行流程：

```mermaid
sequenceDiagram
    participant U as 开发者
    participant C as Codex CLI
    participant FS as 文件系统
    participant S as 沙箱
    
    U->>C: 提交重构任务
    C->>FS: 读取项目结构
    C->>C: 分析代码，规划修改
    C->>S: 在沙箱中执行修改
    S->>S: 运行 PHPStan 检查
    S->>S: 运行 Pest 测试
    S-->>C: 检查结果
    C-->>U: 展示 diff 和测试结果
    U->>C: 确认应用修改
    C->>FS: 写入实际文件
```

### 3.2 生成的 Enum 文件

Codex CLI 生成的代码质量出乎意料地好：

```php
<?php

namespace App\Enums;

enum OrderStatus: string
{
    case Pending = '1';
    case Paid = '2';
    case Cancelled = '3';
    case Refunding = '4';
    case Refunded = '5';

    /**
     * 获取状态的中文描述
     */
    public function label(): string
    {
        return match ($this) {
            self::Pending => '待支付',
            self::Paid => '已支付',
            self::Cancelled => '已取消',
            self::Refunding => '退款中',
            self::Refunded => '已退款',
        };
    }

    /**
     * 判断是否为终态
     */
    public function isTerminal(): bool
    {
        return in_array($this, [
            self::Cancelled,
            self::Refunded,
        ]);
    }

    /**
     * 获取允许的下一个状态
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Pending => [self::Paid, self::Cancelled],
            self::Paid => [self::Refunding, self::Cancelled],
            self::Refunding => [self::Refunded],
            default => [],
        };
    }
}
```

### 3.3 实际替换效果

```php
// 重构后
use App\Enums\OrderStatus;

if ($order->status === OrderStatus::Pending->value) {
    // 待支付
}

// 更好的写法：直接用 Enum 实例
$orderStatus = OrderStatus::from($order->status);
if ($orderStatus === OrderStatus::Pending) {
    // 待支付
}
```

### 3.4 踩坑：上下文窗口溢出

**问题**：30+ 仓库的 monorepo 项目，文件数量超过 500，Codex 读取上下文时超出 token 限制。

```
Error: Context window exceeded (128K tokens)
```

**解决方案**：缩小任务范围，分模块执行：

```bash
# 不要一次性扫描整个项目
# ❌ 错误做法
codex "重构整个项目的所有魔术字符串"

# ✅ 正确做法：分模块
codex "重构 app/Services/Order/ 目录下的订单状态魔术字符串"
codex "重构 app/Http/Controllers/ 目录下的订单状态魔术字符串"
codex "重构 app/Jobs/ 目录下的订单状态魔术字符串"
```

## 4. 实战：自动化测试生成

### 4.1 为遗留 Service 生成 Pest 测试

接手一个没有测试的订单服务：

```bash
codex --approval-mode auto-edit \
    "为 app/Services/OrderService.php 生成完整的 Pest 测试。
     要求：
     1. 使用 Pest 语法，不是 PHPUnit
     2. Mock 所有外部依赖（PaymentGateway、NotificationService）
     3. 覆盖所有公开方法的正常路径和异常路径
     4. 测试文件放在 tests/Unit/Services/OrderServiceTest.php
     5. 使用 Laravel 的 Orchestra Testbench"
```

### 4.2 生成的测试代码

```php
<?php

use App\Enums\OrderStatus;
use App\Models\Order;
use App\Services\OrderService;
use App\Services\PaymentGateway;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->paymentGateway = Mockery::mock(PaymentGateway::class);
    $this->notificationService = Mockery::mock(NotificationService::class);
    $this->service = new OrderService(
        $this->paymentGateway,
        $this->notificationService
    );
});

describe('OrderService::createOrder', function () {
    it('创建订单并返回订单实例', function () {
        $orderData = [
            'user_id' => 1,
            'product_id' => 100,
            'quantity' => 2,
            'amount' => 299.00,
        ];

        $order = $this->service->createOrder($orderData);

        expect($order)->toBeInstanceOf(Order::class)
            ->and($order->status)->toBe(OrderStatus::Pending->value)
            ->and($order->amount)->toBe(299.00);
    });

    it('库存不足时抛出异常', function () {
        $orderData = [
            'user_id' => 1,
            'product_id' => 999,  // 库存为 0 的商品
            'quantity' => 1,
            'amount' => 99.00,
        ];

        $this->service->createOrder($orderData);
    })->throws(\App\Exceptions\InsufficientStockException::class);
});

describe('OrderService::processPayment', function () {
    it('支付成功后更新订单状态为已支付', function () {
        $order = Order::factory()->create([
            'status' => OrderStatus::Pending->value,
        ]);

        $this->paymentGateway
            ->shouldReceive('charge')
            ->once()
            ->with($order->amount, $order->payment_method)
            ->andReturn(['transaction_id' => 'txn_123']);

        $this->notificationService
            ->shouldReceive('sendPaymentConfirmation')
            ->once();

        $result = $this->service->processPayment($order);

        expect($result->status)->toBe(OrderStatus::Paid->value)
            ->and($result->transaction_id)->toBe('txn_123');
    });

    it('支付失败时保持待支付状态并记录错误', function () {
        $order = Order::factory()->create([
            'status' => OrderStatus::Pending->value,
        ]);

        $this->paymentGateway
            ->shouldReceive('charge')
            ->once()
            ->andThrow(new \App\Exceptions\PaymentFailedException('余额不足'));

        $this->service->processPayment($order);

        expect($order->fresh()->status)->toBe(OrderStatus::Pending->value);
    });
});
```

### 4.3 踩坑：Mock 策略不准确

**问题**：Codex 生成的 Mock 基于方法签名，但不了解业务逻辑的实际调用方式，导致测试"绿了但没用"。

**解决方案**：先给 Codex 提供接口文档或示例：

```bash
# 先提供现有测试作为参考
codex --approval-mode auto-edit \
    "参考 tests/Unit/Services/ProductServiceTest.php 的 Mock 风格，
     为 OrderService 生成类似的测试。
     重点测试 processPayment 的支付回调异常处理。"
```

## 5. 实战：代码审查与安全扫描

### 5.1 自动化代码审查

```bash
codex --approval-mode suggest \
    "审查 app/Http/Controllers/API/OrderController.php，
     检查以下安全问题：
     1. SQL 注入风险（特别是 whereRaw 的使用）
     2. 未验证的用户输入
     3. 缺失的授权检查
     4. 敏感数据泄露（是否在响应中暴露了不该暴露的字段）
     输出格式：每个问题标注严重级别（Critical/High/Medium/Low）"
```

### 5.2 输出示例

```markdown
## 代码审查报告

### Critical
- **第 45 行**：`whereRaw("status = '{$request->status}'")` 存在 SQL 注入风险
  → 建议：使用 `where('status', $request->status)`

### High  
- **第 78 行**：`$order->toArray()` 暴露了 `internal_note` 字段
  → 建议：使用 API Resource 过滤字段

### Medium
- **第 23 行**：缺少 `$this->authorize('view', $order)` 权限检查
  → 建议：添加 Policy 授权
```

## 6. Codex CLI vs Claude Code CLI 对比

在同一个 Laravel 项目上测试，对比两个工具的表现：

| 维度 | Codex CLI | Claude Code CLI |
|------|-----------|-----------------|
| **代码生成质量** | ★★★★☆ 结构清晰，但有时过度工程化 | ★★★★★ 更贴近项目风格 |
| **上下文理解** | ★★★☆☆ 大项目容易丢失上下文 | ★★★★☆ 长上下文表现更好 |
| **批量重构** | ★★★★★ 沙箱机制更安全 | ★★★☆☆ 需要更谨慎 |
| **执行速度** | ★★★★☆ 响应快 | ★★★★☆ 响应快 |
| **开源程度** | ★★★★★ 完全开源 | ★☆☆☆☆ 闭源 |
| **成本** | 按 API token 计费 | 按订阅/Token 计费 |

### 6.1 选择建议

```mermaid
graph TD
    A[你的任务是什么？] --> B{需要批量修改文件？}
    B -->|是| C[Codex CLI - 沙箱更安全]
    B -->|否| D{需要深度理解业务逻辑？}
    D -->|是| E[Claude Code - 上下文更强]
    D -->|否| F{需要审计 AI 行为？}
    F -->|是| G[Codex CLI - 完全开源]
    F -->|否| H[两者都可以，看个人偏好]
```

## 7. 高级技巧

### 7.1 配置项目级 `.codex/instructions.md`

类似 `.cursorrules`，为项目定制 AI 行为：

```markdown
# 项目约定

## 技术栈
- Laravel 10 + PHP 8.1
- Pest 测试框架
- PHPStan Level 8

## 代码规范
- Controller 只做参数校验和路由，业务逻辑放 Service
- 使用 Enum 替代所有魔术字符串
- 所有公开方法必须有 PHPDoc
- 测试必须覆盖 happy path + 至少一个异常路径

## 禁止事项
- 不要使用 `DB::raw()`，除非经过团队 Review
- 不要在 Controller 中直接调用 Model
- 不要使用 `dd()` 或 `dump()` 在生产代码中
```

### 7.2 与 CI/CD 集成

```yaml
# .github/workflows/codex-review.yml
name: Codex Code Review
on:
  pull_request:
    paths:
      - 'app/**'
      - 'routes/**'

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install -g @openai/codex
      - env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          codex --approval-mode suggest \
            "Review the changes in this PR. Focus on:
             1. Security vulnerabilities
             2. Performance issues
             3. Logic errors
             Output as markdown." > review.md
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review.md', 'utf8');
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: review
            });
```

## 8. 踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|---------|
| 1 | 上下文窗口溢出 | 项目文件太多 | 分模块执行，缩小范围 |
| 2 | 生成代码风格不一致 | 不了解项目约定 | 配置 `.codex/instructions.md` |
| 3 | Mock 策略不准确 | 缺乏业务上下文 | 提供现有测试作参考 |
| 4 | `full-auto` 模式误删文件 | 沙箱外的操作不可逆 | 关键操作用 `auto-edit` |
| 5 | API 限流 (429) | 批量任务请求过快 | 加 `--max-tokens` 限制 |
| 6 | 生成的 Enum 没有 backing type | 默认生成纯 Enum | 明确指定 `backed enum` |

## 9. 总结

Codex CLI 的核心价值在于**安全的批量自动化**——沙箱机制让你敢放手让它跑批量任务，开源代码让你能审计它的每一步操作。但它的上下文理解能力目前不如 Claude Code，复杂业务逻辑的重构仍需人工把关。

**推荐工作流**：
1. 用 Codex CLI 做批量重构、测试生成等"机械性"工作
2. 用 Claude Code 做需要深度理解业务的代码审查和架构建议
3. 两者互补，而不是二选一

---

*本文基于 OpenAI Codex CLI 2025.x 版本，Laravel 10 + PHP 8.1 项目实测。如有更新会同步修正。*
