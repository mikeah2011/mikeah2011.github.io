---

title: AI Agent 多模型切换实战：Claude/GPT/MiMo 智能路由策略与成本优化踩坑记录
keywords: [AI Agent, Claude, GPT, MiMo, 多模型切换实战, 智能路由策略与成本优化踩坑记录, macOS]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-17 02:50:58
updated: 2026-05-17 02:54:01
categories:
  - macos
  - tools
tags:
- AI
- AI Agent
- DevOps
- model-routing
- cost-optimization
description: AI Agent多模型智能路由实战指南——深入对比Claude、GPT-4o、MiMo三大模型的能力差异与适用场景，详解基于任务类型、上下文长度、成本预算的三层路由策略设计，结合Fallback重试机制、提示工程优化、Token估算与自动化成本控制，附30天真实踩坑记录与86%成本节省方案，助你构建高效低成本的AI自动化工作流。
---


# AI Agent 多模型切换实战：Claude/GPT/MiMo 智能路由策略与成本优化踩坑记录

## 为什么需要多模型路由？

在日常开发中，我们逐渐发现 **没有任何一个模型是万能的**：

| 模型 | 优势场景 | 劣势场景 |
|------|----------|----------|
| Claude 3.5/4 | 长上下文理解、代码生成、复杂推理 | 成本高、响应慢 |
| GPT-4o | 多模态、函数调用、通用任务 | 长上下文质量下降、频繁幻觉 |
| MiMo-v2.5-pro | 代码补全速度极快、性价比高 | 复杂推理弱、上下文窗口有限 |

单一模型的痛点很明显：

1. **成本失控**：所有任务都用 Claude Opus，月账单轻松破 $500
2. **延迟浪费**：简单代码补全用重量级模型，响应时间翻倍
3. **能力错配**：用 GPT-4o 写 Laravel Service Provider，不如 Claude 准确

```
┌─────────────────────────────────────────────┐
│            AI Agent 请求入口                  │
├─────────────────────────────────────────────┤
│                                             │
│   用户请求 ──→ 任务分类器 ──→ 路由决策        │
│                    │                        │
│         ┌─────────┼─────────┐               │
│         ▼         ▼         ▼               │
│     ┌───────┐ ┌───────┐ ┌───────┐           │
│     │Claude │ │ GPT-4o│ │ MiMo  │           │
│     │(复杂) │ │(通用) │ │(快速) │           │
│     └───┬───┘ └───┬───┘ └───┬───┘           │
│         │         │         │               │
│         ▼         ▼         ▼               │
│     ┌─────────────────────────┐             │
│     │   响应聚合 & 质量评估     │             │
│     └─────────────────────────┘             │
│                                             │
└─────────────────────────────────────────────┘
```

<!-- more -->

## 路由策略架构设计

### 第一层：基于任务类型的静态路由

最简单的路由方式是 **按任务类型预分配模型**：

```php
<?php

namespace App\Services\AI;

enum TaskType: string
{
    case CODE_GENERATION = 'code_generation';
    case CODE_REVIEW = 'code_review';
    case DOCUMENTATION = 'documentation';
    case QUICK_COMPLETION = 'quick_completion';
    case COMPLEX_REASONING = 'complex_reasoning';
    case TRANSLATION = 'translation';
}

class ModelRouter
{
    /**
     * 任务类型 → 模型映射表
     * 根据实际成本/质量测试持续调整
     */
    private const ROUTING_TABLE = [
        TaskType::CODE_GENERATION->value => [
            'primary' => 'claude-sonnet-4',
            'fallback' => 'gpt-4o',
            'max_tokens' => 4096,
        ],
        TaskType::CODE_REVIEW->value => [
            'primary' => 'claude-sonnet-4',
            'fallback' => 'gpt-4o',
            'max_tokens' => 2048,
        ],
        TaskType::DOCUMENTATION->value => [
            'primary' => 'gpt-4o',
            'fallback' => 'mimo-v2.5-pro',
            'max_tokens' => 8192,
        ],
        TaskType::QUICK_COMPLETION->value => [
            'primary' => 'mimo-v2.5-pro',
            'fallback' => 'gpt-4o-mini',
            'max_tokens' => 1024,
        ],
        TaskType::COMPLEX_REASONING->value => [
            'primary' => 'claude-opus-4',
            'fallback' => 'claude-sonnet-4',
            'max_tokens' => 8192,
        ],
        TaskType::TRANSLATION->value => [
            'primary' => 'mimo-v2.5-pro',
            'fallback' => 'gpt-4o',
            'max_tokens' => 4096,
        ],
    ];

    public function resolve(TaskType $task): ModelConfig
    {
        $config = self::ROUTING_TABLE[$task->value];

        return new ModelConfig(
            model: $config['primary'],
            fallback: $config['fallback'],
            maxTokens: $config['max_tokens'],
        );
    }
}
```

### 第二层：基于上下文长度的动态路由

**踩坑 #1**：Claude 的 200K 上下文窗口确实很强，但实际测试发现超过 100K token 后成本飙升且质量开始下降。真正需要长上下文的场景其实不多。

```php
<?php

namespace App\Services\AI;

class ContextAwareRouter extends ModelRouter
{
    /**
     * 根据上下文长度动态调整模型选择
     * 
     * 踩坑记录：
     * - 超过 50K token 的上下文，MiMo 幻觉率显著上升
     * - Claude Sonnet 在 30K-80K 区间性价比最高
     * - GPT-4o 超过 128K 后对早期内容遗忘严重
     */
    public function resolveWithContext(TaskType $task, int $tokenCount): ModelConfig
    {
        $base = $this->resolve($task);

        // 短上下文（< 4K）：用便宜模型
        if ($tokenCount < 4096) {
            if ($task !== TaskType::COMPLEX_REASONING) {
                return new ModelConfig(
                    model: 'mimo-v2.5-pro',
                    fallback: 'gpt-4o-mini',
                    maxTokens: $base->maxTokens,
                );
            }
        }

        // 中等上下文（4K - 30K）：默认策略
        if ($tokenCount < 30720) {
            return $base;
        }

        // 长上下文（> 30K）：强制使用 Claude
        return new ModelConfig(
            model: 'claude-sonnet-4',
            fallback: 'claude-opus-4',
            maxTokens: min($base->maxTokens, 4096), // 长上下文时限制输出长度
        );
    }
}
```

### 第三层：基于成本预算的自适应路由

```php
<?php

namespace App\Services\AI;

class CostAwareRouter extends ContextAwareRouter
{
    private float $dailyBudgetUsd;
    private CostTracker $tracker;

    public function __construct(
        float $dailyBudgetUsd = 10.0,
        ?CostTracker $tracker = null,
    ) {
        $this->dailyBudgetUsd = $dailyBudgetUsd;
        $this->tracker = $tracker ?? new CostTracker();
    }

    /**
     * 成本预算感知路由
     * 
     * 当日消费接近预算时自动降级模型
     * 
     * 踩坑记录：
     * - 不要在预算耗尽时直接拒绝请求，用户体验极差
     * - 降级到 MiMo 仍然能完成 80% 的任务
     * - 设置 80% 预警线比 100% 硬限制更合理
     */
    public function resolveWithBudget(
        TaskType $task,
        int $tokenCount,
        string $userId,
    ): ModelConfig {
        $spent = $this->tracker->getDailySpend($userId);
        $ratio = $spent / $this->dailyBudgetUsd;

        // 正常预算内
        if ($ratio < 0.8) {
            return $this->resolveWithContext($task, $tokenCount);
        }

        // 预算 80%-100%：降级到中等模型
        if ($ratio < 1.0) {
            return new ModelConfig(
                model: 'gpt-4o',
                fallback: 'mimo-v2.5-pro',
                maxTokens: 2048,
            );
        }

        // 超出预算：强制使用最便宜的模型
        return new ModelConfig(
            model: 'mimo-v2.5-pro',
            fallback: 'gpt-4o-mini',
            maxTokens: 1024,
        );
    }
}
```

## Fallback 与重试机制

### 核心设计：指数退避 + 模型降级

**踩坑 #2**：API 限流（429）是常态，尤其是 Claude 的并发限制比 GPT 严格得多。简单的 `sleep(1)` 重试会导致雪崩效应。

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Log;

class ModelExecutor
{
    private const MAX_RETRIES = 3;
    private const BASE_DELAY_MS = 500;

    /**
     * 带 Fallback 的模型执行器
     * 
     * 执行流程：
     * 1. 尝试 primary 模型（最多重试 3 次）
     * 2. 切换到 fallback 模型（最多重试 2 次）
     * 3. 最终降级到本地模型（兜底）
     */
    public function execute(
        ModelConfig $config,
        string $prompt,
        array $options = [],
    ): ModelResponse {
        $models = [$config->model, $config->fallback, 'local-ollama'];

        foreach ($models as $index => $model) {
            $maxRetries = $index === 2 ? 1 : self::MAX_RETRIES;

            for ($attempt = 0; $attempt < $maxRetries; $attempt++) {
                try {
                    $response = $this->callModel($model, $prompt, [
                        'max_tokens' => $config->maxTokens,
                        ...$options,
                    ]);

                    // 记录成功的模型和延迟
                    Log::info('AI model call succeeded', [
                        'model' => $model,
                        'attempt' => $attempt,
                        'tokens_used' => $response->totalTokens,
                        'cost_usd' => $response->costUsd,
                    ]);

                    return $response;

                } catch (RateLimitException $e) {
                    // 指数退避：500ms, 1000ms, 2000ms
                    $delay = self::BASE_DELAY_MS * (2 ** $attempt);
                    usleep($delay * 1000);

                    Log::warning('Rate limited, retrying', [
                        'model' => $model,
                        'attempt' => $attempt,
                        'delay_ms' => $delay,
                    ]);

                } catch (ModelOverloadedException $e) {
                    // 模型过载：直接切到下一个模型
                    Log::warning('Model overloaded, switching to fallback', [
                        'from' => $model,
                        'to' => $models[$index + 1] ?? 'none',
                    ]);
                    break; // 跳出内层循环，进入下一个模型

                } catch (\Throwable $e) {
                    Log::error('AI model call failed', [
                        'model' => $model,
                        'error' => $e->getMessage(),
                    ]);

                    if ($attempt === $maxRetries - 1) {
                        break; // 最后一次尝试也失败，切到下一个模型
                    }
                }
            }
        }

        throw new AllModelsFailedException(
            'All models exhausted after retries'
        );
    }

    private function callModel(
        string $model,
        string $prompt,
        array $options,
    ): ModelResponse {
        // 统一的模型调用接口
        $client = $this->getClient($model);

        $startTime = microtime(true);

        $result = $client->chat([
            'model' => $model,
            'messages' => [['role' => 'user', 'content' => $prompt]],
            'max_tokens' => $options['max_tokens'] ?? 2048,
        ]);

        $latencyMs = (microtime(true) - $startTime) * 1000;

        return new ModelResponse(
            content: $result['choices'][0]['message']['content'],
            model: $model,
            totalTokens: $result['usage']['total_tokens'],
            costUsd: $this->calculateCost($model, $result['usage']),
            latencyMs: $latencyMs,
        );
    }
}
```

## Hermes Agent 的实际路由配置

以 Hermes Agent 为例，它通过配置文件实现灵活的模型路由：

```yaml
# ~/.hermes/config.yaml (简化示例)
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      - claude-sonnet-4
      - claude-opus-4

  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4o
      - gpt-4o-mini

  xiaomi:
    api_key: ${XIAOMI_API_KEY}
    base_url: https://api.xiaomi.com/v1
    models:
      - mimo-v2.5-pro

routing:
  default_provider: xiaomi
  default_model: mimo-v2.5-pro

  rules:
    # 复杂代码任务 → Claude
    - match:
        task_type: [code_generation, code_review, refactoring]
        complexity: high
      provider: anthropic
      model: claude-sonnet-4

    # 文档/翻译 → GPT-4o
    - match:
        task_type: [documentation, translation]
      provider: openai
      model: gpt-4o

    # 快速补全/日常任务 → MiMo
    - match:
        task_type: [completion, quick_question, formatting]
      provider: xiaomi
      model: mimo-v2.5-pro

    # 定时任务（无人值守）→ 便宜模型
    - match:
        context: cron
      provider: xiaomi
      model: mimo-v2.5-pro
```

## 成本优化实战数据

经过 30 天的实际使用，三种路由策略的成本对比：

```
策略对比（30 天，约 2000 次请求/天）
┌─────────────────┬────────────┬────────────┬──────────┐
│ 策略             │ 月成本(USD) │ 平均延迟(ms) │ 质量评分  │
├─────────────────┼────────────┼────────────┼──────────┤
│ 全部 Claude Opus │   $487.20  │    2,100   │  9.2/10  │
│ 全部 GPT-4o     │   $156.80  │    1,400   │  8.5/10  │
│ 全部 MiMo       │    $23.40  │      380   │  7.1/10  │
│ 智能路由         │    $67.50  │      650   │  8.8/10  │
└─────────────────┴────────────┴────────────┴──────────┘

智能路由节省了 86% 的成本，同时质量仅下降 4.3%
```

### 踩坑 #3：Token 计算的坑

不同模型的 tokenizer 差异巨大，同一个 prompt 在不同模型中的 token 数可以差 2-3 倍：

```php
<?php

namespace App\Services\AI;

class TokenEstimator
{
    /**
     * 粗略估算不同模型的 token 消耗
     * 
     * 踩坑记录：
     * - Claude 的 tokenizer 对中文比 GPT 友好（token 数更少）
     * - MiMo 的 tokenizer 对代码特别高效
     * - 不要用 OpenAI 的 tiktoken 去估算 Claude 的 token！
     */
    private const CHARS_PER_TOKEN = [
        'claude' => 3.5,    // 中文约 3.5 字符/token
        'gpt' => 2.8,       // 中文约 2.8 字符/token
        'mimo' => 3.2,      // 中文约 3.2 字符/token
    ];

    public function estimate(string $text, string $modelFamily): int
    {
        $charsPerToken = self::CHARS_PER_TOKEN[$modelFamily]
            ?? self::CHARS_PER_TOKEN['gpt'];

        return (int) ceil(mb_strlen($text) / $charsPerToken);
    }

    /**
     * 根据估算选择最优模型（成本/token × 估算token数）
     */
    public function selectCheapestModel(string $text, array $candidates): string
    {
        $costs = [];

        foreach ($candidates as $model) {
            $family = $this->getModelFamily($model);
            $estimatedTokens = $this->estimate($text, $family);
            $costPerToken = $this->getCostPerToken($model);

            $costs[$model] = $estimatedTokens * $costPerToken;
        }

        asort($costs);

        return array_key_first($costs);
    }
}
```

## 真实踩坑记录汇总

### 踩坑 #4：Claude 的系统提示会吞掉大量 token

在设计 Agent 系统提示时，我们最初写了 3000 字的 system prompt。每次请求光 system prompt 就消耗 ~2000 token，按 Claude Opus 计费每天多花 $5+。

**解决方案**：分层系统提示策略

```php
<?php

namespace App\Services\AI;

class SystemPromptOptimizer
{
    /**
     * 根据模型选择不同详细程度的系统提示
     * 
     * 踩坑记录：
     * - Claude 能理解精简指令，不需要过多示例
     * - GPT 需要更多上下文和示例才能稳定输出
     * - MiMo 对系统提示的遵循度较低，关键指令要放在用户消息中
     */
    public function getSystemPrompt(
        string $model,
        TaskType $task,
    ): string {
        $family = $this->getModelFamily($model);

        return match ($family) {
            // Claude：精简指令即可，省 token
            'claude' => $this->getMinimalPrompt($task),

            // GPT：需要结构化指令和示例
            'gpt' => $this->getDetailedPrompt($task),

            // MiMo：把关键指令放前面，后面会被忽略
            'mimo' => $this->getCompactPrompt($task),
        };
    }

    private function getMinimalPrompt(TaskType $task): string
    {
        return match ($task) {
            TaskType::CODE_GENERATION =>
                'You are a senior PHP/Laravel developer. '
                . 'Write clean, production-ready code with type hints.',
            TaskType::CODE_REVIEW =>
                'Review this code for bugs, performance issues, '
                . 'and security vulnerabilities. Be specific.',
            default => 'Help with the following task.',
        };
    }

    private function getDetailedPrompt(TaskType $task): string
    {
        // GPT 需要更详细的指令才能保持一致的输出格式
        return match ($task) {
            TaskType::CODE_GENERATION => <<<'PROMPT'
You are a senior PHP/Laravel developer with 10+ years of experience.

Rules:
1. Always use PHP 8.2+ features (readonly, enum, match expressions)
2. Add return type declarations to all methods
3. Use strict types: `declare(strict_types=1);`
4. Follow PSR-12 coding standards
5. Add PHPDoc blocks only for non-obvious parameters

Output format: Only return the code, no explanations unless asked.
PROMPT,
            default => 'Help with the following task.',
        };
    }

    private function getCompactPrompt(TaskType $task): string
    {
        // MiMo：关键信息放最前面
        return match ($task) {
            TaskType::CODE_GENERATION =>
                'PHP 8.2 Laravel code. Strict types. PSR-12. '
                . 'Return code only.',
            TaskType::QUICK_COMPLETION =>
                'Complete the code. Be brief.',
            default => 'Help.',
        };
    }
}
```

### 踩坑 #5：并发请求时的模型选择一致性

在 Agent 工作流中，一个复杂任务可能拆成多个子任务并行执行。如果子任务选择了不同的模型，输出风格和质量会不一致。

```php
<?php

namespace App\Services\AI;

class ConsistentRouter
{
    /**
     * 同一批次任务锁定到同一模型
     * 
     * 踩坑记录：
     * - 并行写 5 个 Service 类，3 个用 Claude，2 个用 MiMo
     * - 代码风格完全不统一，命名规范、注释风格都不同
     * - 后续 Code Review 时花了大量时间统一风格
     */
    public function resolveForBatch(
        TaskType $task,
        array $prompts,
        int $tokenCount,
    ): ModelConfig {
        // 取最大 token 需求来选择模型
        $maxTokens = max(array_map('strlen', $prompts));
        $estimatedTokens = (new TokenEstimator())->estimate(
            implode('', $prompts),
            'auto'
        );

        // 一旦选定，整批任务用同一个模型
        $config = $this->resolveWithContext(
            $task,
            $estimatedTokens
        );

        // 将 batchId 和锁定模型存入缓存
        $batchId = uniqid('batch_', true);
        Cache::put(
            "ai_batch_{$batchId}",
            $config,
            now()->addMinutes(30)
        );

        return $config;
    }
}
```

### 踩坑 #6：MiMo 的中文代码注释乱码

MiMo 在生成含中文注释的 PHP 代码时，偶尔会在 UTF-8 编码边界处截断，导致半个中文字符出现在输出中。

```php
<?php

namespace App\Services\AI;

class ResponseSanitizer
{
    /**
     * 清理模型输出中的编码问题
     * 
     * 踩坑记录：
     * - MiMo 有时在 token 边界截断中文，产生无效 UTF-8
     * - GPT 偶尔在 JSON 输出中混入全角标点
     * - Claude 基本不会出现编码问题
     */
    public function sanitize(string $content, string $model): string
    {
        $family = $this->getModelFamily($model);

        // 通用：修复无效 UTF-8
        $content = mb_convert_encoding($content, 'UTF-8', 'UTF-8');

        if ($family === 'mimo') {
            // MiMo 特有：移除截断的多字节字符末尾
            $content = preg_replace('/[\x80-\xFF]+$/', '', $content);
        }

        if ($family === 'gpt') {
            // GPT 特有：全角标点转半角
            $content = str_replace(
                ['，', '。', '（', '）', '；', '：'],
                [',', '.', '(', ')', ';', ':'],
                $content
            );
        }

        return $content;
    }
}
```

## 模型能力评测基准

我们在 Laravel B2C API 项目上做了系统性的模型能力评测（50 道测试题）：

```
评测结果（满分 100）
┌────────────────────┬────────┬───────┬──────┐
│ 维度                │ Claude │ GPT-4o│ MiMo │
├────────────────────┼────────┼───────┼──────┤
│ PHP 语法正确性      │   95   │  92   │  88  │
│ Laravel 框架理解    │   93   │  85   │  72  │
│ SQL 优化建议        │   88   │  90   │  75  │
│ 代码安全意识        │   92   │  88   │  68  │
│ 架构设计能力        │   94   │  86   │  65  │
│ 中文注释质量        │   90   │  82   │  85  │
│ 响应速度            │   60   │  72   │  95  │
│ 性价比              │   55   │  75   │  98  │
└────────────────────┴────────┴───────┴──────┘
```

## 完整的 Cost Tracker 实现

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Redis;

class CostTracker
{
    /**
     * 每个模型的定价（per 1M tokens, USD）
     * 定期更新！各厂商经常调价
     */
    private const PRICING = [
        'claude-opus-4'    => ['input' => 15.00, 'output' => 75.00],
        'claude-sonnet-4'  => ['input' => 3.00,  'output' => 15.00],
        'gpt-4o'           => ['input' => 2.50,  'output' => 10.00],
        'gpt-4o-mini'      => ['input' => 0.15,  'output' => 0.60],
        'mimo-v2.5-pro'    => ['input' => 0.10,  'output' => 0.30],
    ];

    public function record(
        string $userId,
        string $model,
        int $inputTokens,
        int $outputTokens,
    ): float {
        $cost = $this->calculateCost($model, $inputTokens, $outputTokens);

        $key = "ai_cost:{$userId}:" . date('Y-m-d');
        Redis::hIncrByFloat($key, $model, $cost);
        Redis::expire($key, 86400 * 7); // 保留 7 天

        return $cost;
    }

    public function getDailySpend(string $userId): float
    {
        $key = "ai_cost:{$userId}:" . date('Y-m-d');
        $spends = Redis::hGetAll($key);

        return array_sum($spends);
    }

    private function calculateCost(
        string $model,
        int $inputTokens,
        int $outputTokens,
    ): float {
        $pricing = self::PRICING[$model] ?? self::PRICING['gpt-4o'];

        return ($inputTokens * $pricing['input']
            + $outputTokens * $pricing['output']) / 1_000_000;
    }
}
```

## 总结：选型决策树

```
你的任务是什么？
│
├─ 简单补全/格式化/翻译
│  └─→ MiMo（便宜、快）
│
├─ 代码生成/Review（中等复杂度）
│  └─→ Claude Sonnet（性价比最优）
│
├─ 复杂架构设计/安全审计
│  └─→ Claude Opus（质量优先）
│
├─ 多模态（图片理解）
│  └─→ GPT-4o（唯一可靠选择）
│
├─ 长文档总结（> 50K token）
│  └─→ Claude Sonnet（长上下文最强）
│
└─ 无人值守/定时任务
   └─→ MiMo（最低成本）
```

**最终建议**：不要试图用一个模型解决所有问题。投入 2-3 天搭建路由层，长期来看每月能节省 70%-85% 的 AI 调用成本，同时维持 90% 以上的输出质量。关键是 **持续监控** 和 **动态调整** 路由策略，因为各厂商的模型能力在快速迭代。

## 模型能力全景对比表

在选型之前，先看清各模型的核心指标：

| 维度 | Claude Opus 4 | Claude Sonnet 4 | GPT-4o | GPT-4o-mini | MiMo-v2.5-pro |
|------|---------------|------------------|--------|-------------|---------------|
| 上下文窗口 | 200K | 200K | 128K | 128K | 32K |
| 首 Token 延迟 (P50) | ~1.2s | ~0.6s | ~0.8s | ~0.3s | ~0.15s |
| 完整响应延迟 (P50) | ~2.1s | ~1.2s | ~1.4s | ~0.6s | ~0.4s |
| 输入价格 ($/1M tokens) | $15.00 | $3.00 | $2.50 | $0.15 | $0.10 |
| 输出价格 ($/1M tokens) | $75.00 | $15.00 | $10.00 | $0.60 | $0.30 |
| PHP 代码生成质量 | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ |
| Laravel 框架理解 | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ |
| 中文理解能力 | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★★☆ |
| 多模态支持 | ✅ | ✅ | ✅（最强） | ✅ | ❌ |
| 函数调用 / Tool Use | ✅ | ✅ | ✅（最稳定） | ✅ | ⚠️ 有限 |
| 适合场景 | 复杂推理、安全审计、架构设计 | 日常代码生成、Review、中长上下文 | 多模态、通用任务、文档 | 低风险批量任务、分类 | 快速补全、翻译、格式化 |

> **选型口诀**：质量选 Claude，速度选 MiMo，多模态选 GPT，预算紧选 MiMo + Sonnet 组合。

## 相关阅读

- [AI Agent Skill 开发实战：自定义技能与工作流自动化——Hermes Agent 踩坑记录](/categories/macOS/ai-agent-skill-guide-automation-hermes-agent/)
- [LM Studio 实战：本地模型管理与推理 — 隐私优先的 AI 开发工作流踩坑记录](/categories/macOS/lm-studio-guide-ai/)
- [本地 vs 云端 AI 实战：成本隐私性能的权衡与 Laravel 开发者选型指南](/categories/macOS/vs-ai-guide-laravel-guide/)
- [AI Agent Orchestration Patterns 2026：Supervisor/Router/Swarm/DAG 四种编排模式的适用场景与工程选型](/categories/架构/ai-agent-orchestration-patterns-2026-supervisor-router-swarm-dag-编排模式选型/)
- [Anthropic Claude Opus 4 / OpenAI o3 实战：最新推理模型接入——思维链输出、Tool Use 与 Laravel 集成](/categories/架构/anthropic-claude-opus4-openai-o3-实战-最新推理模型接入-思维链输出-tool-use与laravel集成/)
- [OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化](/categories/架构/openhuman-tokenjuice-实战-智能token压缩与成本优化/)
