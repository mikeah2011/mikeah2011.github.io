---
title: AI Agent 工具设计模式实战：参数校验、错误分类、重试策略与降级方案
keywords: [AI Agent, 工具设计模式实战, 参数校验, 错误分类, 重试策略与降级方案, AI]
date: 2026-06-10 07:56:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - 工具设计
  - 错误处理
  - 重试策略
  - 降级方案
  - PHP
  - Laravel
description: 从工具注册到生产可用的完整工程闭环，涵盖参数校验、错误分类、重试策略与降级方案的实战设计模式
---


## 概述

在构建 AI Agent 系统时，工具（Tool）是 Agent 与外部世界交互的桥梁。一个设计良好的工具系统不仅要能完成功能，更要在生产环境中保持稳定、可预测、可恢复。

本文将从实际项目经验出发，详细介绍 AI Agent 工具设计中的核心模式：

- **参数校验**：确保输入合法，防止脏数据污染
- **错误分类**：区分可恢复错误与不可恢复错误
- **重试策略**：智能重试，避免雪崩
- **降级方案**：当工具不可用时的优雅退化

我们将使用 PHP/Laravel 作为主要实现语言，因为这是 Michael 日常开发的技术栈。

## 核心概念

### 1. 工具注册机制

工具注册是整个系统的基础。每个工具需要声明自己的元数据、参数定义和执行逻辑。

```php
<?php

namespace App\AI\Tools;

use App\AI\Tools\Contracts\ToolInterface;
use App\AI\Tools\Contracts\ParameterDefinition;

class WeatherTool implements ToolInterface
{
    public function getName(): string
    {
        return 'get_weather';
    }

    public function getDescription(): string
    {
        return '获取指定城市的当前天气信息';
    }

    public function getParameters(): array
    {
        return [
            new ParameterDefinition(
                name: 'city',
                type: 'string',
                description: '城市名称，如"上海"、"北京"',
                required: true,
                constraints: ['min_length' => 1, 'max_length' => 50]
            ),
            new ParameterDefinition(
                name: 'unit',
                type: 'string',
                description: '温度单位',
                required: false,
                default: 'celsius',
                constraints: ['enum' => ['celsius', 'fahrenheit']]
            ),
        ];
    }

    public function execute(array $parameters): ToolResult
    {
        // 工具执行逻辑
    }
}
```

**设计要点：**

- 参数定义使用强类型，而非简单的数组
- 每个参数包含约束条件（枚举、长度限制等）
- 工具返回统一的 `ToolResult` 类型

### 2. 参数校验层

参数校验是防止脏数据进入系统的第一道防线。我们需要在工具执行前进行严格校验。

```php
<?php

namespace App\AI\Tools\Validation;

use App\AI\Tools\Contracts\ParameterDefinition;
use App\AI\Tools\Exceptions\ValidationException;

class ParameterValidator
{
    /**
     * 校验参数
     *
     * @param array $definitions 参数定义
     * @param array $input 用户输入
     * @return array 校验后的参数
     * @throws ValidationException
     */
    public function validate(array $definitions, array $input): array
    {
        $validated = [];

        foreach ($definitions as $definition) {
            $name = $definition->getName();
            $value = $input[$name] ?? null;

            // 必填校验
            if ($definition->isRequired() && $value === null) {
                throw ValidationException::missingRequired($name);
            }

            // 使用默认值
            if ($value === null) {
                $validated[$name] = $definition->getDefault();
                continue;
            }

            // 类型校验
            $value = $this->validateType($name, $value, $definition->getType());

            // 约束校验
            $this->validateConstraints($name, $value, $definition->getConstraints());

            $validated[$name] = $value;
        }

        // 检查是否有未知参数
        $knownNames = array_column($definitions, 'name');
        $unknown = array_diff_key($input, array_flip($knownNames));
        if (!empty($unknown)) {
            throw ValidationException::unknownParameters(array_keys($unknown));
        }

        return $validated;
    }

    private function validateType(string $name, mixed $value, string $type): mixed
    {
        return match ($type) {
            'string' => $this->validateString($name, $value),
            'integer' => $this->validateInteger($name, $value),
            'number' => $this->validateNumber($name, $value),
            'boolean' => $this->validateBoolean($name, $value),
            'array' => $this->validateArray($name, $value),
            default => $value,
        };
    }

    private function validateString(string $name, mixed $value): string
    {
        if (!is_string($value)) {
            throw ValidationException::typeMismatch($name, 'string', get_debug_type($value));
        }
        return trim($value);
    }

    private function validateInteger(string $name, mixed $value): int
    {
        if (!is_numeric($value)) {
            throw ValidationException::typeMismatch($name, 'integer', get_debug_type($value));
        }
        return (int) $value;
    }

    private function validateNumber(string $name, mixed $value): float
    {
        if (!is_numeric($value)) {
            throw ValidationException::typeMismatch($name, 'number', get_debug_type($value));
        }
        return (float) $value;
    }

    private function validateBoolean(string $name, mixed $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    private function validateArray(string $name, mixed $value): array
    {
        if (!is_array($value)) {
            throw ValidationException::typeMismatch($name, 'array', get_debug_type($value));
        }
        return $value;
    }

    private function validateConstraints(string $name, mixed $value, array $constraints): void
    {
        foreach ($constraints as $constraint => $params) {
            match ($constraint) {
                'enum' => $this->validateEnum($name, $value, $params),
                'min_length' => $this->validateMinLength($name, $value, $params),
                'max_length' => $this->validateMaxLength($name, $value, $params),
                'min' => $this->validateMin($name, $value, $params),
                'max' => $this->validateMax($name, $value, $params),
                'pattern' => $this->validatePattern($name, $value, $params),
                default => null,
            };
        }
    }

    private function validateEnum(string $name, mixed $value, array $allowed): void
    {
        if (!in_array($value, $allowed, true)) {
            throw ValidationException::invalidEnum($name, $allowed, $value);
        }
    }

    private function validateMinLength(string $name, mixed $value, int $min): void
    {
        if (is_string($value) && mb_strlen($value) < $min) {
            throw ValidationException::tooShort($name, $min, mb_strlen($value));
        }
    }

    private function validateMaxLength(string $name, mixed $value, int $max): void
    {
        if (is_string($value) && mb_strlen($value) > $max) {
            throw ValidationException::tooLong($name, $max, mb_strlen($value));
        }
    }

    private function validateMin(string $name, mixed $value, float $min): void
    {
        if (is_numeric($value) && $value < $min) {
            throw ValidationException::tooSmall($name, $min, $value);
        }
    }

    private function validateMax(string $name, mixed $value, float $max): void
    {
        if (is_numeric($value) && $value > $max) {
            throw ValidationException::tooLarge($name, $max, $value);
        }
    }

    private function validatePattern(string $name, mixed $value, string $pattern): void
    {
        if (is_string($value) && !preg_match($pattern, $value)) {
            throw ValidationException::patternMismatch($name, $pattern);
        }
    }
}
```

### 3. 错误分类系统

错误分类是重试策略和降级方案的基础。我们需要将错误分为几个明确的类别：

```php
<?php

namespace App\AI\Tools\Errors;

enum ErrorCategory: string
{
    /**
     * 可重试的临时错误
     * 例如：网络超时、服务暂时不可用
     */
    case TRANSIENT = 'transient';

    /**
     * 客户端错误，不可重试
     * 例如：参数校验失败、权限不足
     */
    case CLIENT = 'client';

    /**
     * 服务端错误，可重试但需谨慎
     * 例如：内部服务错误、数据库连接失败
     */
    case SERVER = 'server';

    /**
     * 资源限制错误
     * 例如：API 配额耗尽、速率限制
     */
    case RATE_LIMIT = 'rate_limit';

    /**
     * 不可恢复的永久错误
     * 例如：工具不存在、配置错误
     */
    case FATAL = 'fatal';

    /**
     * 判断是否可重试
     */
    public function isRetryable(): bool
    {
        return in_array($this, [
            self::TRANSIENT,
            self::SERVER,
            self::RATE_LIMIT,
        ]);
    }

    /**
     * 判断是否需要降级
     */
    public function requiresFallback(): bool
    {
        return in_array($this, [
            self::TRANSIENT,
            self::SERVER,
            self::RATE_LIMIT,
            self::FATAL,
        ]);
    }

    /**
     * 获取最大重试次数
     */
    public function getMaxRetries(): int
    {
        return match ($this) {
            self::TRANSIENT => 3,
            self::SERVER => 2,
            self::RATE_LIMIT => 1,
            self::CLIENT => 0,
            self::FATAL => 0,
        };
    }

    /**
     * 获取重试延迟（毫秒）
     */
    public function getRetryDelay(int $attempt): int
    {
        return match ($this) {
            self::TRANSIENT => (int) (1000 * pow(2, $attempt)), // 指数退避
            self::SERVER => (int) (2000 * pow(2, $attempt)),
            self::RATE_LIMIT => 5000, // 固定延迟
            default => 0,
        };
    }
}
```

### 4. 错误包装器

将原生异常转换为结构化的错误信息：

```php
<?php

namespace App\AI\Tools\Errors;

use Throwable;

class ToolError
{
    public function __construct(
        public readonly string $toolName,
        public readonly ErrorCategory $category,
        public readonly string $message,
        public readonly ?Throwable $previous = null,
        public readonly array $context = [],
        public readonly ?string $retryAfter = null,
    ) {}

    /**
     * 从 HTTP 响应创建错误
     */
    public static function fromHttpResponse(string $toolName, int $statusCode, string $body): self
    {
        $category = match (true) {
            $statusCode >= 500 => ErrorCategory::SERVER,
            $statusCode === 429 => ErrorCategory::RATE_LIMIT,
            $statusCode === 404 => ErrorCategory::CLIENT,
            $statusCode >= 400 => ErrorCategory::CLIENT,
            default => ErrorCategory::TRANSIENT,
        };

        $retryAfter = null;
        if ($statusCode === 429) {
            $retryAfter = '5s'; // 默认 5 秒
        }

        return new self(
            toolName: $toolName,
            category: $category,
            message: "HTTP {$statusCode}: {$body}",
            context: ['status_code' => $statusCode, 'response_body' => $body],
            retryAfter: $retryAfter,
        );
    }

    /**
     * 从异常创建错误
     */
    public static function fromException(string $toolName, Throwable $e): self
    {
        $category = match (get_class($e)) {
            \GuzzleHttp\Exception\ConnectException::class => ErrorCategory::TRANSIENT,
            \GuzzleHttp\Exception\TransferException::class => ErrorCategory::SERVER,
            \InvalidArgumentException::class => ErrorCategory::CLIENT,
            \App\AI\Tools\Exceptions\ValidationException::class => ErrorCategory::CLIENT,
            default => ErrorCategory::SERVER,
        };

        return new self(
            toolName: $toolName,
            category: $category,
            message: $e->getMessage(),
            previous: $e,
            context: ['exception_class' => get_class($e)],
        );
    }

    /**
     * 转换为用户友好的错误信息
     */
    public function toUserMessage(): string
    {
        return match ($this->category) {
            ErrorCategory::TRANSIENT => "工具 {$this->toolName} 暂时不可用，请稍后重试",
            ErrorCategory::CLIENT => "参数错误：{$this->message}",
            ErrorCategory::SERVER => "工具 {$this->toolName} 内部错误",
            ErrorCategory::RATE_LIMIT => "工具 {$this->toolName} 请求频率过高，请稍后重试",
            ErrorCategory::FATAL => "工具 {$this->toolName} 配置错误，请联系管理员",
        };
    }
}
```

## 实战代码

### 1. 重试中间件

实现一个可配置的重试机制，支持指数退避和抖动：

```php
<?php

namespace App\AI\Tools\Middleware;

use App\AI\Tools\Contracts\ToolInterface;
use App\AI\Tools\Errors\ErrorCategory;
use App\AI\Tools\Errors\ToolError;
use App\AI\Tools\ToolResult;
use App\AI\Tools\ToolRunner;
use Illuminate\Support\Facades\Log;
use Throwable;

class RetryMiddleware
{
    public function __construct(
        private int $maxRetries = 3,
        private float $baseDelay = 1.0,
        private float $maxDelay = 30.0,
        private bool $jitter = true,
    ) {}

    public function handle(ToolInterface $tool, array $parameters, callable $next): ToolResult
    {
        $lastError = null;
        $maxAttempts = $this->maxRetries + 1;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $result = $next($tool, $parameters);

                // 成功，记录重试次数（如果有）
                if ($attempt > 1) {
                    Log::info('Tool succeeded after retry', [
                        'tool' => $tool->getName(),
                        'attempt' => $attempt,
                    ]);
                }

                return $result;

            } catch (Throwable $e) {
                $lastError = ToolError::fromException($tool->getName(), $e);

                // 判断是否可重试
                if (!$lastError->category->isRetryable()) {
                    Log::warning('Tool failed with non-retryable error', [
                        'tool' => $tool->getName(),
                        'category' => $lastError->category->value,
                        'error' => $lastError->message,
                    ]);
                    throw $e;
                }

                // 已达最大重试次数
                if ($attempt >= $maxAttempts) {
                    Log::error('Tool failed after max retries', [
                        'tool' => $tool->getName(),
                        'attempts' => $attempt,
                        'error' => $lastError->message,
                    ]);
                    throw $e;
                }

                // 计算延迟
                $delay = $this->calculateDelay($lastError->category, $attempt);

                Log::warning('Tool failed, retrying', [
                    'tool' => $tool->getName(),
                    'attempt' => $attempt,
                    'category' => $lastError->category->value,
                    'delay_ms' => $delay,
                    'error' => $lastError->message,
                ]);

                // 等待
                usleep($delay * 1000);
            }
        }

        // 不应该到达这里，但以防万一
        throw $lastError->previous ?? new \RuntimeException('Max retries exceeded');
    }

    private function calculateDelay(ErrorCategory $category, int $attempt): int
    {
        $baseDelay = match ($category) {
            ErrorCategory::TRANSIENT => $this->baseDelay * 1000,
            ErrorCategory::SERVER => $this->baseDelay * 2000,
            ErrorCategory::RATE_LIMIT => 5000,
            default => $this->baseDelay * 1000,
        };

        // 指数退避
        $delay = $baseDelay * pow(2, $attempt - 1);

        // 添加抖动（0-25%）
        if ($this->jitter) {
            $delay *= (1 + mt_rand(0, 25) / 100);
        }

        // 限制最大延迟
        return (int) min($delay, $this->maxDelay * 1000);
    }
}
```

### 2. 降级策略

当工具不可用时，提供优雅的降级方案：

```php
<?php

namespace App\AI\Tools\Fallback;

use App\AI\Tools\Contracts\ToolInterface;
use App\AI\Tools\Errors\ToolError;
use App\AI\Tools\ToolResult;
use Closure;

class FallbackManager
{
    private array $fallbacks = [];

    /**
     * 注册降级策略
     */
    public function register(string $toolName, Closure $handler): self
    {
        $this->fallbacks[$toolName] = $handler;
        return $this;
    }

    /**
     * 执行降级
     */
    public function execute(string $toolName, ToolError $error, array $parameters): ?ToolResult
    {
        if (!isset($this->fallbacks[$toolName])) {
            return null;
        }

        try {
            $handler = $this->fallbacks[$toolName];
            return $handler($error, $parameters);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Fallback also failed', [
                'tool' => $toolName,
                'original_error' => $error->message,
                'fallback_error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * 检查是否有降级策略
     */
    public function hasFallback(string $toolName): bool
    {
        return isset($this->fallbacks[$toolName]);
    }
}
```

### 3. 完整的工具运行器

将所有组件组合在一起：

```php
<?php

namespace App\AI\Tools;

use App\AI\Tools\Contracts\ToolInterface;
use App\AI\Tools\Errors\ToolError;
use App\AI\Tools\Fallback\FallbackManager;
use App\AI\Tools\Middleware\RetryMiddleware;
use App\AI\Tools\Validation\ParameterValidator;
use Illuminate\Support\Facades\Log;
use Throwable;

class ToolRunner
{
    private array $tools = [];
    private ParameterValidator $validator;
    private RetryMiddleware $retryMiddleware;
    private FallbackManager $fallbackManager;

    public function __construct()
    {
        $this->validator = new ParameterValidator();
        $this->retryMiddleware = new RetryMiddleware(
            maxRetries: 3,
            baseDelay: 1.0,
            jitter: true,
        );
        $this->fallbackManager = new FallbackManager();
    }

    /**
     * 注册工具
     */
    public function register(ToolInterface $tool): self
    {
        $this->tools[$tool->getName()] = $tool;
        return $this;
    }

    /**
     * 注册降级策略
     */
    public function registerFallback(string $toolName, \Closure $handler): self
    {
        $this->fallbackManager->register($toolName, $handler);
        return $this;
    }

    /**
     * 执行工具
     */
    public function run(string $toolName, array $parameters): ToolResult
    {
        // 1. 查找工具
        $tool = $this->tools[$toolName] ?? null;
        if (!$tool) {
            throw new \InvalidArgumentException("Tool not found: {$toolName}");
        }

        // 2. 参数校验
        try {
            $validatedParams = $this->validator->validate(
                $tool->getParameters(),
                $parameters
            );
        } catch (Throwable $e) {
            Log::warning('Parameter validation failed', [
                'tool' => $toolName,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // 3. 执行（带重试）
        try {
            return $this->retryMiddleware->handle(
                $tool,
                $validatedParams,
                fn($tool, $params) => $tool->execute($params)
            );
        } catch (Throwable $e) {
            $error = ToolError::fromException($toolName, $e);

            Log::error('Tool execution failed', [
                'tool' => $toolName,
                'category' => $error->category->value,
                'error' => $error->message,
            ]);

            // 4. 尝试降级
            if ($this->fallbackManager->hasFallback($toolName)) {
                $fallbackResult = $this->fallbackManager->execute(
                    $toolName,
                    $error,
                    $validatedParams
                );

                if ($fallbackResult) {
                    Log::info('Fallback succeeded', ['tool' => $toolName]);
                    return $fallbackResult;
                }
            }

            // 5. 无降级方案，抛出异常
            throw $e;
        }
    }

    /**
     * 获取所有已注册工具的定义（用于 LLM）
     */
    public function getToolDefinitions(): array
    {
        return array_map(fn($tool) => [
            'name' => $tool->getName(),
            'description' => $tool->getDescription(),
            'parameters' => array_map(fn($p) => [
                'name' => $p->getName(),
                'type' => $p->getType(),
                'description' => $p->getDescription(),
                'required' => $p->isRequired(),
                'default' => $p->getDefault(),
            ], $tool->getParameters()),
        ], $this->tools);
    }
}
```

### 4. 实际使用示例

```php
<?php

use App\AI\Tools\ToolRunner;
use App\AI\Tools\WeatherTool;
use App\AI\Tools\SearchTool;

// 初始化
$runner = new ToolRunner();

// 注册工具
$runner->register(new WeatherTool());
$runner->register(new SearchTool());

// 注册降级策略
$runner->registerFallback('get_weather', function ($error, $params) {
    // 当天气 API 不可用时，返回缓存数据
    $cached = Cache::get("weather:{$params['city']}");
    if ($cached) {
        return ToolResult::success($cached, source: 'cache');
    }
    return ToolResult::success([
        'city' => $params['city'],
        'weather' => '未知',
        'message' => '天气服务暂时不可用',
    ], source: 'fallback');
});

// 执行工具
try {
    $result = $runner->run('get_weather', [
        'city' => '上海',
        'unit' => 'celsius',
    ]);

    if ($result->isSuccess()) {
        $weather = $result->getData();
        echo "当前天气：{$weather['temperature']}°C，{$weather['description']}";
    } else {
        echo "获取天气失败：{$result->getError()}";
    }
} catch (\Throwable $e) {
    echo "工具执行异常：{$e->getMessage()}";
}
```

## 踩坑记录

### 坑 1：重试风暴

**问题**：多个 Agent 同时调用同一个工具，失败后同时重试，导致服务端压力倍增。

**解决方案**：
- 添加随机抖动（jitter），让重试时间错开
- 实现全局限流器，控制并发重试数量
- 使用 Redis 分布式锁，确保同一时刻只有一个重试请求

```php
// 全局限流器
class GlobalRetryLimiter
{
    private int $maxConcurrentRetries = 10;

    public function acquire(string $toolName): bool
    {
        $key = "retry_lock:{$toolName}";
        $current = Redis::incr($key);

        if ($current === 1) {
            Redis::expire($key, 30); // 30 秒过期
        }

        if ($current > $this->maxConcurrentRetries) {
            Redis::decr($key);
            return false;
        }

        return true;
    }

    public function release(string $toolName): void
    {
        Redis::decr("retry_lock:{$toolName}");
    }
}
```

### 坑 2：错误分类不准确

**问题**：将所有 HTTP 500 错误都归类为 `SERVER`，但实际上有些是永久性的配置错误。

**解决方案**：
- 根据错误码细分：502/503/504 是临时错误，500 可能是代码 bug
- 检查响应体中的错误信息，识别特定错误模式
- 记录错误历史，自动学习哪些错误是可重试的

```php
public static function fromHttpResponse(string $toolName, int $statusCode, string $body): self
{
    $category = match (true) {
        // 临时性网关错误
        in_array($statusCode, [502, 503, 504]) => ErrorCategory::TRANSIENT,

        // 可能是代码 bug
        $statusCode === 500 => self::classify500Error($body),

        // 速率限制
        $statusCode === 429 => ErrorCategory::RATE_LIMIT,

        // 其他客户端错误
        $statusCode >= 400 && $statusCode < 500 => ErrorCategory::CLIENT,

        default => ErrorCategory::TRANSIENT,
    };

    // ...
}

private static function classify500Error(string $body): ErrorCategory
{
    // 检查是否是已知的永久性错误模式
    $permanentPatterns = [
        'database connection refused',
        'configuration error',
        'missing required extension',
    ];

    foreach ($permanentPatterns as $pattern) {
        if (stripos($body, $pattern) !== false) {
            return ErrorCategory::FATAL;
        }
    }

    return ErrorCategory::SERVER;
}
```

### 坑 3：降级返回假数据

**问题**：降级策略返回了虚假的成功数据，导致 Agent 基于错误信息做出决策。

**解决方案**：
- 降级结果必须标记 `source: 'fallback'` 或 `source: 'cache'`
- Agent 需要检查数据来源，对降级数据持怀疑态度
- 关键操作（如支付、删除）禁止降级

```php
class ToolResult
{
    public function __construct(
        public readonly bool $success,
        public readonly ?array $data = null,
        public readonly ?string $error = null,
        public readonly string $source = 'direct', // direct, cache, fallback
        public readonly array $metadata = [],
    ) {}

    public function isFromFallback(): bool
    {
        return $this->source === 'fallback';
    }

    public function isReliable(): bool
    {
        return $this->source === 'direct';
    }
}
```

### 坑 4：参数校验过于宽松

**问题**：只校验了类型，没有校验业务逻辑（如邮箱格式、URL 格式）。

**解决方案**：
- 添加业务级校验器
- 使用 Laravel 的 `Rule` 类复用校验逻辑
- 支持自定义校验规则

```php
class BusinessValidator
{
    private array $rules = [
        'email' => ['email:rfc,dns'],
        'url' => ['url', 'active_url'],
        'phone' => ['regex:/^1[3-9]\d{9}$/'],
        'date' => ['date', 'after:today'],
    ];

    public function validate(string $fieldName, mixed $value): void
    {
        $fieldRules = $this->rules[$fieldName] ?? [];

        $validator = Validator::make(
            [$fieldName => $value],
            [$fieldName => $fieldRules]
        );

        if ($validator->fails()) {
            throw ValidationException::businessRuleFailed(
                $fieldName,
                $validator->errors()->first($fieldName)
            );
        }
    }
}
```

## 总结

构建生产级的 AI Agent 工具系统，需要关注以下几个关键点：

1. **参数校验要严格**：不要相信任何外部输入，类型、格式、业务逻辑都要校验
2. **错误分类要准确**：区分可恢复和不可恢复错误，这是重试和降级的基础
3. **重试要智能**：指数退避 + 抖动 + 全局限流，避免重试风暴
4. **降级要诚实**：降级数据必须标记来源，让 Agent 知道数据的可靠性
5. **日志要完整**：每次工具调用都要记录，方便排查问题

这些模式不是孤立的，而是相互配合的。一个好的工具系统，应该能在各种异常情况下都能优雅地处理，而不是直接崩溃。

在实际项目中，建议从简单开始，逐步增加复杂度。先实现基本的参数校验和错误处理，再添加重试和降级。不要过度设计，但也不要忽视生产环境的稳定性。

---

**相关文章：**

- [AI Agent 工具调用的错误处理最佳实践](/2026/06/10/ai-agent-tool-error-handling/)
- [PHP 中实现指数退避重试的几种方式](/2026/06/10/php-exponential-backoff-retry/)
- [Laravel 中构建可扩展的中间件系统](/2026/06/10/laravel-extensible-middleware/)
