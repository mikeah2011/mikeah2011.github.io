---

title: AI Agent Self-Healing 实战：工具调用失败自动诊断与替代——Fallback Chain + Error Pattern Matching
keywords: [AI Agent Self, Healing, Fallback Chain, Error Pattern Matching, 工具调用失败自动诊断与替代, AI]
date: 2026-06-10 00:45:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- AI Agent
- Self-Healing
- Fallback Chain
- Error Pattern Matching
- Laravel
- 可靠性
description: 本文深入探讨 AI Agent 在工具调用失败时的自动诊断与替代方案，通过 Fallback Chain 和 Error Pattern Matching 构建自治愈架构，实现 Agent 的高可用运行。
---



## 引言

在构建生产级 AI Agent 系统时，工具调用失败是不可避免的现实。API 超时、服务不可用、参数格式错误、权限不足——这些故障如果不能被优雅处理，Agent 就会卡死在某一步，整个任务链随之崩溃。

传统的做法是 try-catch 加重试，但这种方式有几个致命问题：

- **重试策略单一**：不管什么错误都重试 3 次，浪费资源
- **缺乏诊断能力**：不知道失败的根本原因，无法做出智能决策
- **没有替代路径**：一个工具挂了就整个流程挂了

Self-Healing 架构的核心思想是：**让 Agent 具备"感知故障 → 诊断原因 → 选择替代方案 → 自动恢复"的能力**。这不是简单的错误处理，而是一套完整的自治系统。

本文将实现两个核心组件：

1. **Error Pattern Matching**：错误模式匹配引擎，对不同类型的失败进行分类诊断
2. **Fallback Chain**：降级链，为每个工具调用预设多条替代路径

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                   Agent Runtime                      │
│                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌────────────┐ │
│  │  Tool     │───▶│ Error Pattern │───▶│  Fallback  │ │
│  │  Executor │    │   Matcher    │    │   Chain    │ │
│  └──────────┘    └──────────────┘    └────────────┘ │
│       │                │                    │        │
│       ▼                ▼                    ▼        │
│  ┌──────────┐    ┌──────────────┐    ┌────────────┐ │
│  │  Result   │    │  Diagnostic  │    │  Recovery  │ │
│  │  Validator│    │   Report     │    │   Action   │ │
│  └──────────┘    └──────────────┘    └────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │          Healing History & Metrics            │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 核心概念

### Error Pattern Matching

不是所有错误都一样。超时错误应该重试，认证错误应该刷新 Token，参数错误应该修正参数。Error Pattern Matching 的目标是：**根据错误的特征，自动分类并给出最佳处理策略**。

### Fallback Chain

为每个工具调用定义一条降级链。主工具失败后，按优先级依次尝试替代方案。比如查询天气：

1. 主方案：调用 OpenWeatherMap API
2. 备用 1：调用 WeatherAPI.com
3. 备用 2：从本地缓存取最近一次的数据
4. 兜底：返回"天气服务暂时不可用"

## 实战代码

### 1. 错误模式定义

首先定义错误模式的结构：

```php
<?php

namespace App\Agent\SelfHealing;

use InvalidArgumentException;

enum ErrorCategory: string
{
    case TIMEOUT = 'timeout';
    case AUTH_FAILURE = 'auth_failure';
    case RATE_LIMIT = 'rate_limit';
    case INVALID_PARAMS = 'invalid_params';
    case SERVICE_UNAVAILABLE = 'service_unavailable';
    case NETWORK_ERROR = 'network_error';
    case PERMISSION_DENIED = 'permission_denied';
    case UNKNOWN = 'unknown';
}

enum RecoveryStrategy: string
{
    case RETRY_IMMEDIATELY = 'retry_immediately';
    case RETRY_WITH_BACKOFF = 'retry_with_backoff';
    case REFRESH_CREDENTIALS = 'refresh_credentials';
    case FIX_PARAMS = 'fix_params';
    case USE_FALLBACK = 'use_fallback';
    case ABORT = 'abort';
}

class ErrorPattern
{
    public function __construct(
        public readonly ErrorCategory $category,
        public readonly string $pattern,        // 正则表达式
        public readonly RecoveryStrategy $strategy,
        public readonly int $maxRetries = 3,
        public readonly int $backoffMs = 1000,
        public readonly ?string $hint = null,
    ) {}

    public function matches(string $errorMessage): bool
    {
        return preg_match($this->pattern, $errorMessage) === 1;
    }
}
```

### 2. Error Pattern Matcher

核心匹配引擎，维护一个模式库，对每个错误进行分类：

```php
<?php

namespace App\Agent\SelfHealing;

class ErrorPatternMatcher
{
    /** @var ErrorPattern[] */
    private array $patterns = [];

    public function __construct()
    {
        $this->registerDefaultPatterns();
    }

    private function registerDefaultPatterns(): void
    {
        // 超时类错误
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::TIMEOUT,
            pattern: '/timeout|timed?\s*out|deadline\s*exceeded|request\s*timeout/i',
            strategy: RecoveryStrategy::RETRY_WITH_BACKOFF,
            maxRetries: 3,
            backoffMs: 2000,
            hint: '请求超时，将使用指数退避重试',
        ));

        // 认证失败
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::AUTH_FAILURE,
            pattern: '/401|unauthorized|invalid.*(token|key|credential)|auth.*fail|expired.*token/i',
            strategy: RecoveryStrategy::REFRESH_CREDENTIALS,
            maxRetries: 1,
            hint: '认证失败，尝试刷新凭据后重试',
        ));

        // 频率限制
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::RATE_LIMIT,
            pattern: '/429|rate.?limit|too.?many.?requests|throttl/i',
            strategy: RecoveryStrategy::RETRY_WITH_BACKOFF,
            maxRetries: 5,
            backoffMs: 5000,
            hint: '触发频率限制，等待后重试',
        ));

        // 参数错误
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::INVALID_PARAMS,
            pattern: '/400|bad.?request|invalid.?param|validation.?error|missing.?required/i',
            strategy: RecoveryStrategy::FIX_PARAMS,
            maxRetries: 1,
            hint: '参数错误，需要修正请求参数',
        ));

        // 服务不可用
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::SERVICE_UNAVAILABLE,
            pattern: '/502|503|504|service.?unavailable|bad.?gateway|server.?error/i',
            strategy: RecoveryStrategy::USE_FALLBACK,
            maxRetries: 2,
            backoffMs: 3000,
            hint: '服务不可用，切换到备用方案',
        ));

        // 网络错误
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::NETWORK_ERROR,
            pattern: '/network.?error|connection.?refused|dns.?resolve|ECONNREFUSED|ENOTFOUND/i',
            strategy: RecoveryStrategy::RETRY_WITH_BACKOFF,
            maxRetries: 3,
            backoffMs: 3000,
            hint: '网络错误，重试中',
        ));

        // 权限不足
        $this->addPattern(new ErrorPattern(
            category: ErrorCategory::PERMISSION_DENIED,
            pattern: '/403|forbidden|permission.?denied|access.?denied/i',
            strategy: RecoveryStrategy::ABORT,
            maxRetries: 0,
            hint: '权限不足，无法自动恢复，需人工介入',
        ));
    }

    public function addPattern(ErrorPattern $pattern): void
    {
        $this->patterns[] = $pattern;
    }

    /**
     * 匹配错误信息，返回诊断结果
     */
    public function diagnose(string $errorMessage): DiagnosisResult
    {
        foreach ($this->patterns as $pattern) {
            if ($pattern->matches($errorMessage)) {
                return new DiagnosisResult(
                    category: $pattern->category,
                    strategy: $pattern->strategy,
                    maxRetries: $pattern->maxRetries,
                    backoffMs: $pattern->backoffMs,
                    hint: $pattern->hint ?? '未知错误模式',
                    originalError: $errorMessage,
                    matchedPattern: $pattern->pattern,
                );
            }
        }

        // 未匹配任何已知模式
        return new DiagnosisResult(
            category: ErrorCategory::UNKNOWN,
            strategy: RecoveryStrategy::RETRY_WITH_BACKOFF,
            maxRetries: 1,
            backoffMs: 2000,
            hint: '遇到未知错误类型，尝试一次重试后切换备用方案',
            originalError: $errorMessage,
            matchedPattern: null,
        );
    }
}

class DiagnosisResult
{
    public function __construct(
        public readonly ErrorCategory $category,
        public readonly RecoveryStrategy $strategy,
        public readonly int $maxRetries,
        public readonly int $backoffMs,
        public readonly string $hint,
        public readonly string $originalError,
        public readonly ?string $matchedPattern,
    ) {}

    public function shouldRetry(): bool
    {
        return in_array($this->strategy, [
            RecoveryStrategy::RETRY_IMMEDIATELY,
            RecoveryStrategy::RETRY_WITH_BACKOFF,
            RecoveryStrategy::REFRESH_CREDENTIALS,
            RecoveryStrategy::FIX_PARAMS,
        ]);
    }

    public function shouldUseFallback(): bool
    {
        return $this->strategy === RecoveryStrategy::USE_FALLBACK;
    }

    public function isAborted(): bool
    {
        return $this->strategy === RecoveryStrategy::ABORT;
    }
}
```

### 3. Fallback Chain

为每个工具定义降级链，主工具失败后自动切换：

```php
<?php

namespace App\Agent\SelfHealing;

use Closure;

class FallbackStep
{
    public function __construct(
        public readonly string $name,
        public readonly Closure $executor,
        public readonly ?Closure $condition = null, // 条件判断，是否可用
        public readonly int $priority = 0,          // 优先级，越小越优先
    ) {}
}

class FallbackChain
{
    /** @var FallbackStep[] */
    private array $steps = [];

    public function __construct(
        private readonly string $toolName,
        private readonly ErrorPatternMatcher $matcher,
        private readonly ?HealingHistory $history = null,
    ) {}

    public function addStep(FallbackStep $step): self
    {
        $this->steps[] = $step;
        usort($this->steps, fn($a, $b) => $a->priority <=> $b->priority);
        return $this;
    }

    /**
     * 执行降级链，直到成功或所有方案耗尽
     */
    public function execute(array $params): ChainResult
    {
        $attempts = [];
        $lastError = null;

        foreach ($this->steps as $step) {
            // 检查条件是否满足
            if ($step->condition && !$step->condition($params)) {
                $attempts[] = [
                    'step' => $step->name,
                    'status' => 'skipped',
                    'reason' => '条件不满足',
                ];
                continue;
            }

            $retryCount = 0;
            $maxRetries = 3; // 默认重试次数
            $diagnosis = null;

            while ($retryCount <= $maxRetries) {
                try {
                    $startTime = microtime(true);
                    $result = ($step->executor)($params);
                    $duration = microtime(true) - $startTime;

                    $attempts[] = [
                        'step' => $step->name,
                        'status' => 'success',
                        'retry' => $retryCount,
                        'duration_ms' => round($duration * 1000, 2),
                    ];

                    // 记录成功
                    if ($this->history) {
                        $this->history->recordSuccess($this->toolName, $step->name);
                    }

                    return new ChainResult(
                        success: true,
                        result: $result,
                        attempts: $attempts,
                        finalStep: $step->name,
                    );

                } catch (\Throwable $e) {
                    $lastError = $e->getMessage();
                    $diagnosis = $this->matcher->diagnose($lastError);
                    $maxRetries = $diagnosis->maxRetries;

                    $attempts[] = [
                        'step' => $step->name,
                        'status' => 'failed',
                        'retry' => $retryCount,
                        'error' => $lastError,
                        'category' => $diagnosis->category->value,
                        'strategy' => $diagnosis->strategy->value,
                    ];

                    // 记录失败
                    if ($this->history) {
                        $this->history->recordFailure(
                            $this->toolName,
                            $step->name,
                            $diagnosis->category,
                            $lastError,
                        );
                    }

                    // 如果诊断结果是中止，直接跳出
                    if ($diagnosis->isAborted()) {
                        break;
                    }

                    // 如果需要重试
                    if ($diagnosis->shouldRetry() && $retryCount < $maxRetries) {
                        $retryCount++;
                        $backoff = $diagnosis->backoffMs * pow(2, $retryCount - 1);
                        usleep($backoff * 1000);
                        continue;
                    }

                    // 当前步骤失败，尝试下一步
                    break;
                }
            }
        }

        // 所有方案都失败了
        return new ChainResult(
            success: false,
            result: null,
            attempts: $attempts,
            finalStep: null,
            error: $lastError,
        );
    }
}

class ChainResult
{
    public function __construct(
        public readonly bool $success,
        public readonly mixed $result,
        public readonly array $attempts,
        public readonly ?string $finalStep,
        public readonly ?string $error = null,
    ) {}

    public function getSummary(): string
    {
        $total = count($this->attempts);
        $successSteps = array_filter($this->attempts, fn($a) => $a['status'] === 'success');
        $failedSteps = array_filter($this->attempts, fn($a) => $a['status'] === 'failed');

        $summary = $this->success
            ? "✅ 执行成功 (使用 {$this->finalStep})"
            : "❌ 所有方案均失败 (最后错误: {$this->error})";

        return "{$summary}\n" .
               "  总尝试: {$total} 步, " .
               "成功: " . count($successSteps) . ", " .
               "失败: " . count($failedSteps);
    }
}
```

### 4. Healing History

记录历史故障和恢复情况，用于趋势分析和智能决策：

```php
<?php

namespace App\Agent\SelfHealing;

use Illuminate\Support\Facades\Cache;
use Carbon\Carbon;

class HealingHistory
{
    private const CACHE_PREFIX = 'agent:healing:';
    private const HISTORY_TTL = 86400 * 7; // 7 天

    public function recordSuccess(string $toolName, string $stepName): void
    {
        $key = self::CACHE_PREFIX . "success:{$toolName}";
        $history = Cache::get($key, []);
        $history[] = [
            'step' => $stepName,
            'timestamp' => now()->toIso8601String(),
        ];

        // 保留最近 100 条记录
        if (count($history) > 100) {
            $history = array_slice($history, -100);
        }

        Cache::put($key, $history, self::HISTORY_TTL);
    }

    public function recordFailure(
        string $toolName,
        string $stepName,
        ErrorCategory $category,
        string $error,
    ): void {
        $key = self::CACHE_PREFIX . "failure:{$toolName}";
        $history = Cache::get($key, []);
        $history[] = [
            'step' => $stepName,
            'category' => $category->value,
            'error' => $error,
            'timestamp' => now()->toIso8601String(),
        ];

        if (count($history) > 100) {
            $history = array_slice($history, -100);
        }

        Cache::put($key, $history, self::HISTORY_TTL);

        // 更新错误计数（用于熔断判断）
        $countKey = self::CACHE_PREFIX . "error_count:{$toolName}:{$category->value}";
        Cache::increment($countKey);
        Cache::put($countKey . ':last_at', now()->toIso8601String(), self::HISTORY_TTL);
    }

    /**
     * 获取工具的错误率（最近 N 次调用）
     */
    public function getErrorRate(string $toolName, int $window = 20): float
    {
        $successKey = self::CACHE_PREFIX . "success:{$toolName}";
        $failureKey = self::CACHE_PREFIX . "failure:{$toolName}";

        $successes = count(Cache::get($successKey, []));
        $failures = count(Cache::get($failureKey, []));

        $total = $successes + $failures;
        if ($total === 0) {
            return 0.0;
        }

        // 取最近 window 次的结果
        $recentFailures = array_slice(Cache::get($failureKey, []), -$window);
        $recentSuccesses = array_slice(Cache::get($successKey, []), -$window);

        $recentTotal = count($recentFailures) + count($recentSuccesses);
        return $recentTotal > 0 ? count($recentFailures) / $recentTotal : 0.0;
    }

    /**
     * 判断工具是否应该被熔断（错误率过高）
     */
    public function shouldCircuitBreak(string $toolName, float $threshold = 0.7): bool
    {
        return $this->getErrorRate($toolName) > $threshold;
    }

    /**
     * 获取诊断报告
     */
    public function getDiagnosticReport(string $toolName): array
    {
        $failureKey = self::CACHE_PREFIX . "failure:{$toolName}";
        $failures = Cache::get($failureKey, []);

        $byCategory = [];
        foreach ($failures as $f) {
            $cat = $f['category'] ?? 'unknown';
            $byCategory[$cat] = ($byCategory[$cat] ?? 0) + 1;
        }

        return [
            'tool' => $toolName,
            'error_rate' => round($this->getErrorRate($toolName) * 100, 1) . '%',
            'total_failures' => count($failures),
            'by_category' => $byCategory,
            'should_circuit_break' => $this->shouldCircuitBreak($toolName),
            'last_failure' => end($failures) ?: null,
        ];
    }
}
```

### 5. Self-Healing Agent Runtime

把所有组件组合起来，构建完整的自治愈 Agent 运行时：

```php
<?php

namespace App\Agent\SelfHealing;

use Illuminate\Support\Facades\Log;

class SelfHealingRuntime
{
    private ErrorPatternMatcher $matcher;
    private HealingHistory $history;

    /** @var array<string, FallbackChain> */
    private array $chains = [];

    public function __construct()
    {
        $this->matcher = new ErrorPatternMatcher();
        $this->history = new HealingHistory();
    }

    /**
     * 注册工具的降级链
     */
    public function registerChain(string $toolName, callable $builder): FallbackChain
    {
        $chain = new FallbackChain($toolName, $this->matcher, $this->history);
        $builder($chain);
        $this->chains[$toolName] = $chain;
        return $chain;
    }

    /**
     * 执行工具调用（带自动恢复）
     */
    public function callTool(string $toolName, array $params): ChainResult
    {
        // 检查是否应该熔断
        if ($this->history->shouldCircuitBreak($toolName)) {
            Log::warning("工具 {$toolName} 触发熔断保护", [
                'error_rate' => $this->history->getErrorRate($toolName),
            ]);

            return new ChainResult(
                success: false,
                result: null,
                attempts: [],
                finalStep: null,
                error: "工具 {$toolName} 错误率过高，已触发熔断保护",
            );
        }

        // 检查是否注册了降级链
        if (!isset($this->chains[$toolName])) {
            // 没有降级链，直接执行（无保护）
            try {
                $result = $this->executeDirect($toolName, $params);
                return new ChainResult(
                    success: true,
                    result: $result,
                    attempts: [['step' => 'direct', 'status' => 'success']],
                    finalStep: 'direct',
                );
            } catch (\Throwable $e) {
                return new ChainResult(
                    success: false,
                    result: null,
                    attempts: [['step' => 'direct', 'status' => 'failed', 'error' => $e->getMessage()]],
                    finalStep: null,
                    error: $e->getMessage(),
                );
            }
        }

        // 使用降级链执行
        $result = $this->chains[$toolName]->execute($params);

        Log::info("工具 {$toolName} 执行完成", [
            'success' => $result->success,
            'steps' => count($result->attempts),
            'final_step' => $result->finalStep,
        ]);

        return $result;
    }

    /**
     * 获取所有工具的健康报告
     */
    public function getHealthReport(): array
    {
        $report = [];
        foreach (array_keys($this->chains) as $toolName) {
            $report[$toolName] = $this->history->getDiagnosticReport($toolName);
        }
        return $report;
    }

    private function executeDirect(string $toolName, array $params): mixed
    {
        // 这里接入实际的工具执行逻辑
        throw new \RuntimeException("工具 {$toolName} 未注册降级链，请使用 registerChain 注册");
    }
}
```

### 6. Laravel Service Provider 注册

```php
<?php

namespace App\Providers;

use App\Agent\SelfHealing\SelfHealingRuntime;
use Illuminate\Support\ServiceProvider;

class SelfHealingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SelfHealingRuntime::class, function ($app) {
            $runtime = new SelfHealingRuntime();

            // 注册内置工具的降级链
            $this->registerBuiltinChains($runtime);

            return $runtime;
        });
    }

    private function registerBuiltinChains(SelfHealingRuntime $runtime): void
    {
        // 天气查询工具
        $runtime->registerChain('weather_query', function ($chain) {
            $chain->addStep(new \App\Agent\SelfHealing\FallbackStep(
                name: 'openweathermap',
                executor: fn($params) => app('weather.openweathermap')->query($params['city']),
                priority: 0,
            ));

            $chain->addStep(new \App\Agent\SelfHealing\FallbackStep(
                name: 'weatherapi',
                executor: fn($params) => app('weather.weatherapi')->query($params['city']),
                priority: 1,
            ));

            $chain->addStep(new \App\Agent\SelfHealing\FallbackStep(
                name: 'local_cache',
                executor: fn($params) => cache("weather:{$params['city']}"),
                condition: fn($params) => cache()->has("weather:{$params['city']}"),
                priority: 2,
            ));
        });

        // 数据库查询工具
        $runtime->registerChain('db_query', function ($chain) {
            $chain->addStep(new \App\Agent\SelfHealing\FallbackStep(
                name: 'primary_db',
                executor: fn($params) => \DB::connection('mysql')
                    ->select($params['query'], $params['bindings'] ?? []),
                priority: 0,
            ));

            $chain->addStep(new \App\Agent\SelfHealing\FallbackStep(
                name: 'read_replica',
                executor: fn($params) => \DB::connection('mysql_read')
                    ->select($params['query'], $params['bindings'] ?? []),
                priority: 1,
            ));
        });
    }
}
```

### 7. Agent 调用示例

在 Agent 的工具调用层集成 Self-Healing：

```php
<?php

namespace App\Agent;

use App\Agent\SelfHealing\SelfHealingRuntime;
use Illuminate\Support\Facades\Log;

class ToolExecutor
{
    public function __construct(
        private SelfHealingRuntime $runtime,
    ) {}

    /**
     * Agent 调用工具的入口
     */
    public function execute(string $toolName, array $params): array
    {
        $result = $this->runtime->callTool($toolName, $params);

        if ($result->success) {
            return [
                'success' => true,
                'data' => $result->result,
                'meta' => [
                    'healing_steps' => count($result->attempts),
                    'final_step' => $result->finalStep,
                ],
            ];
        }

        // 所有方案都失败，返回结构化错误
        Log::error("工具 {$toolName} 所有降级方案均失败", [
            'attempts' => $result->attempts,
            'error' => $result->error,
        ]);

        return [
            'success' => false,
            'error' => $result->error,
            'diagnosis' => $this->buildDiagnosisSummary($result),
            'suggestion' => $this->buildSuggestion($toolName, $result),
        ];
    }

    private function buildDiagnosisSummary($result): string
    {
        $categories = array_unique(array_column($result->attempts, 'category'));
        return "失败原因分类: " . implode(', ', array_filter($categories));
    }

    private function buildSuggestion(string $toolName, $result): string
    {
        $report = $this->runtime->getHealthReport();

        if (isset($report[$toolName]) && $report[$toolName]['should_circuit_break']) {
            return "该工具错误率过高，建议检查上游服务状态或手动干预";
        }

        return "建议检查网络连接和工具配置，或联系运维团队";
    }
}
```

## 踩坑记录

### 1. 重试风暴

**问题**：在分布式环境中，多个 Agent 实例同时重试同一个失败的外部服务，导致重试风暴，反而加剧了上游服务的负载。

**解决**：加入随机抖动（jitter）：

```php
// ❌ 固定退避，所有实例同一时刻重试
$sleepMs = $backoffMs * pow(2, $retryCount);

// ✅ 加入随机抖动
$jitter = random_int(0, (int)($backoffMs * 0.5));
$sleepMs = $backoffMs * pow(2, $retryCount) + $jitter;
```

### 2. 幂等性问题

**问题**：重试非幂等操作（如扣款、发消息）导致重复执行。

**解决**：在 FallbackChain 中强制要求幂等 token：

```php
class FallbackStep
{
    public function __construct(
        public readonly string $name,
        public readonly Closure $executor,
        public readonly bool $idempotent = true, // 标记是否幂等
        public readonly ?Closure $idempotencyKeyGenerator = null,
        // ...
    ) {}
}

// 在 Chain 执行时
if (!$step->idempotent && $retryCount > 0) {
    // 非幂等操作，重试前检查是否已经执行成功
    $existingResult = $this->checkIdempotency($step, $params);
    if ($existingResult !== null) {
        return $existingResult;
    }
}
```

### 3. 熔断器恢复

**问题**：熔断器触发后，即使上游服务恢复了，Agent 也不会重新尝试调用。

**解决**：实现半开状态：

```php
public function shouldCircuitBreak(string $toolName, float $threshold = 0.7): bool
{
    $stateKey = self::CACHE_PREFIX . "circuit_state:{$toolName}";
    $state = Cache::get($stateKey, 'closed');

    return match ($state) {
        'open' => true,  // 熔断中，拒绝所有请求
        'half-open' => false, // 半开状态，允许一个请求通过
        default => $this->getErrorRate($toolName) > $threshold,
    };
}

public function onCircuitBreakSuccess(string $toolName): void
{
    // 成功后关闭熔断器
    Cache::put(self::CACHE_PREFIX . "circuit_state:{$toolName}", 'closed', 300);
}

public function onCircuitBreakFailure(string $toolName): void
{
    $stateKey = self::CACHE_PREFIX . "circuit_state:{$toolName}";
    $currentState = Cache::get($stateKey, 'closed');

    if ($currentState === 'half-open') {
        // 半开状态下又失败了，重新打开熔断器
        Cache::put($stateKey, 'open', 60);
    } else {
        Cache::put($stateKey, 'open', 60);
    }
}
```

### 4. 诊断结果的日志噪声

**问题**：每次错误都打日志，日志量爆炸。

**解决**：按错误类别采样，高频错误降采样：

```php
private function shouldLog(ErrorCategory $category): bool
{
    return match ($category) {
        ErrorCategory::PERMISSION_DENIED => true,  // 权限错误始终记录
        ErrorCategory::AUTH_FAILURE => true,
        default => random_int(1, 10) <= 3,  // 其他错误 30% 采样
    };
}
```

## 生产环境建议

### 1. 监控指标

建议暴露以下 Prometheus 指标：

```php
// 工具调用总次数（按结果分类）
agent_tool_calls_total{tool="weather", result="success|fallback|failed"}

// 恢复耗时
agent_healing_duration_seconds{tool="weather", strategy="retry_with_backoff"}

// 熔断器状态
agent_circuit_breaker_state{tool="weather"}  # 0=closed, 1=open, 2=half-open
```

### 2. 可观测性

每次 Self-Healing 的执行都应该生成结构化的 trace，方便排查：

```json
{
    "trace_id": "abc-123",
    "tool": "weather_query",
    "total_attempts": 3,
    "final_step": "weatherapi",
    "total_duration_ms": 4521,
    "attempts": [
        {"step": "openweathermap", "status": "failed", "error": "timeout", "duration_ms": 5000},
        {"step": "openweathermap", "status": "failed", "error": "timeout", "duration_ms": 5000},
        {"step": "weatherapi", "status": "success", "duration_ms": 234}
    ]
}
```

### 3. 降级链的版本管理

降级链配置应该支持动态更新，而不是硬编码在代码里。可以存储在数据库或配置中心：

```php
// 从配置中心加载降级链
$chainConfig = Cache::remember('agent:fallback_chains:weather', 300, function () {
    return DB::table('agent_fallback_configs')
        ->where('tool_name', 'weather_query')
        ->orderBy('priority')
        ->get()
        ->toArray();
});
```

## 总结

Self-Healing 架构不是银弹，但它能让 Agent 在面对故障时表现得像一个有经验的运维工程师：**知道出了什么问题，知道该怎么做，知道什么时候该放弃**。

关键设计原则：

1. **错误分类要精确**：不是所有错误都该重试，认证失败重试 100 次也没用
2. **降级链要有层次**：从最优方案到兜底方案，层层递进
3. **熔断器要防雪崩**：上游挂了就别继续打了，给它恢复的时间
4. **历史记录要保留**：这是 Agent 学习的基础，也是运维排查的依据
5. **可观测性不能少**：没有 trace 的 Self-Healing 就是黑盒

在实际项目中，建议先从最核心、最容易出错的工具开始接入 Self-Healing，逐步扩展。不要一开始就给所有工具都加上降级链——过度设计比没有设计更危险。
