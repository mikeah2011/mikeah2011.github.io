---
title: AI Agent Tool Design 深度实战：工具定义规范、参数校验、错误分类、重试策略与降级方案
keywords: [AI Agent Tool Design, 深度实战, 工具定义规范, 参数校验, 错误分类, 重试策略与降级方案, AI]
date: 2026-06-10 09:27:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - Tool Design
  - PHP
  - Laravel
  - LLM
description: 从工具注册到生产可用的完整工程闭环——深入探讨 AI Agent 工具系统的设计规范、参数校验、错误处理、重试策略与降级方案，附带完整的 PHP/Laravel 实战代码。
---


## 概述

在构建 AI Agent 应用时，工具（Tool/Function）是连接 LLM 与外部世界的桥梁。一个设计良好的工具系统，决定了 Agent 能否稳定可靠地完成任务。

很多开发者在原型阶段能快速跑通 demo，但一旦进入生产环境，就会遇到各种问题：参数校验缺失导致调用失败、错误没有分类导致重试策略混乱、超时和限流没有降级方案导致用户体验极差。

本文将从工程实践的角度，完整覆盖 AI Agent 工具系统的五大核心环节：**工具定义规范、参数校验、错误分类、重试策略与降级方案**，并提供可直接运行的 PHP/Laravel 代码。

## 一、工具定义规范

### 1.1 为什么需要规范

LLM 通过 JSON Schema 来理解工具的输入输出。如果定义不清晰，LLM 可能会：
- 传错参数类型（字符串传成数字）
- 遗漏必填参数
- 误解参数含义（"date" 是 Unix 时间戳还是 "YYYY-MM-DD"）

### 1.2 Tool Schema 标准结构

```php
<?php

namespace App\Services\Agent\Tools;

use JsonSchema\Constraints\Constraint;
use JsonSchema\Validator;

abstract class BaseTool
{
    /**
     * 工具名称，LLM 通过此名称调用
     */
    abstract public function getName(): string;

    /**
     * 工具描述，帮助 LLM 理解何时使用
     */
    abstract public function getDescription(): string;

    /**
     * JSON Schema 参数定义
     */
    abstract function getParameters(): array;

    /**
     * 执行工具逻辑
     */
    abstract function execute(array $params): ToolResult;

    /**
     * 生成 OpenAI function calling 格式
     */
    public function toFunctionSchema(): array
    {
        return [
            'type' => 'function',
            'function' => [
                'name' => $this->getName(),
                'description' => $this->getDescription(),
                'parameters' => [
                    'type' => 'object',
                    'properties' => $this->getParameters(),
                    'required' => $this->getRequiredFields(),
                    'additionalProperties' => false,
                ],
            ],
        ];
    }

    protected function getRequiredFields(): array
    {
        return [];
    }
}
```

### 1.3 具体工具示例：天气查询

```php
<?php

namespace App\Services\Agent\Tools;

class WeatherTool extends BaseTool
{
    public function getName(): string
    {
        return 'get_weather';
    }

    public function getDescription(): string
    {
        return '获取指定城市的当前天气信息。返回温度、湿度、天气状况和风力。仅支持中国大陆城市。';
    }

    public function getParameters(): array
    {
        return [
            'city' => [
                'type' => 'string',
                'description' => '城市名称，如"上海"、"北京"。不要加"市"后缀。',
            ],
            'unit' => [
                'type' => 'string',
                'enum' => ['celsius', 'fahrenheit'],
                'description' => '温度单位，默认摄氏度',
            ],
        ];
    }

    public function getRequiredFields(): array
    {
        return ['city'];
    }

    public function execute(array $params): ToolResult
    {
        $city = $params['city'];
        $unit = $params['unit'] ?? 'celsius';

        // 实际调用天气 API
        $weather = app(WeatherService::class)->fetch($city, $unit);

        return ToolResult::success([
            'city' => $city,
            'temperature' => $weather['temp'],
            'humidity' => $weather['humidity'],
            'condition' => $weather['condition'],
            'wind' => $weather['wind'],
        ]);
    }
}
```

### 1.4 描述的最佳实践

| 坏描述 | 好描述 |
|--------|--------|
| "查询天气" | "获取指定城市的当前天气信息。返回温度、湿度、天气状况和风力。仅支持中国大陆城市。" |
| "搜索文档" | "在内部知识库中搜索文档。返回最相关的 5 篇文档标题和摘要。如果无结果返回空数组。" |

关键原则：
- **说清楚返回什么**：LLM 需要知道结果长什么样
- **说清楚边界**：支持什么、不支持什么
- **说清楚默认值**：可选参数的默认行为

## 二、参数校验

### 2.1 为什么不能信任 LLM 输出

LLM 生成的参数可能存在以下问题：
- 类型错误：`"temperature": "25度"` 而不是 `"temperature": 25`
- 范围越界：`"limit": 10000` 超出 API 限制
- 格式错误：`"date": "昨天"` 而不是 `"date": "2026-06-09"`
- 注入攻击：`"query": "'; DROP TABLE users; --"` 

### 2.2 分层校验策略

```php
<?php

namespace App\Services\Agent\Validation;

use App\Exceptions\ToolValidationException;

class ToolParameterValidator
{
    private array $errors = [];

    /**
     * 校验工具参数
     */
    public function validate(array $params, array $schema): array
    {
        $this->errors = [];

        // 第一层：类型校验
        $this->validateTypes($params, $schema);

        // 第二层：必填字段校验
        $this->validateRequired($params, $schema);

        // 第三层：范围和枚举校验
        $this->validateConstraints($params, $schema);

        // 第四层：业务规则校验
        $this->validateBusinessRules($params, $schema);

        if (!empty($this->errors)) {
            throw new ToolValidationException($this->errors);
        }

        return $this->sanitize($params, $schema);
    }

    private function validateTypes(array $params, array $schema): void
    {
        $properties = $schema['properties'] ?? [];

        foreach ($params as $key => $value) {
            if (!isset($properties[$key])) {
                continue;
            }

            $expectedType = $properties[$key]['type'];
            $actualType = gettype($value);

            $typeMap = [
                'string' => 'string',
                'integer' => 'integer',
                'number' => ['integer', 'double'],
                'boolean' => 'boolean',
                'array' => 'array',
                'object' => 'object',
            ];

            $expected = $typeMap[$expectedType] ?? $expectedType;

            if (is_array($expected)) {
                if (!in_array($actualType, $expected, true)) {
                    $this->errors[] = "参数 '{$key}' 类型错误：期望 {$expectedType}，实际 {$actualType}";
                }
            } else {
                if ($actualType !== $expected) {
                    $this->errors[] = "参数 '{$key}' 类型错误：期望 {$expectedType}，实际 {$actualType}";
                }
            }
        }
    }

    private function validateRequired(array $params, array $schema): void
    {
        $required = $schema['required'] ?? [];

        foreach ($required as $field) {
            if (!array_key_exists($field, $params)) {
                $this->errors[] = "缺少必填参数：{$field}";
            } elseif ($params[$field] === null || $params[$field] === '') {
                $this->errors[] = "参数 '{$field}' 不能为空";
            }
        }
    }

    private function validateConstraints(array $params, array $schema): void
    {
        $properties = $schema['properties'] ?? [];

        foreach ($params as $key => $value) {
            if (!isset($properties[$key])) {
                continue;
            }

            $prop = $properties[$key];

            // 枚举校验
            if (isset($prop['enum'])) {
                if (!in_array($value, $prop['enum'], true)) {
                    $this->errors[] = "参数 '{$key}' 值无效：{$value}，可选值：" . implode(', ', $prop['enum']);
                }
            }

            // 数值范围
            if (isset($prop['minimum']) && is_numeric($value) && $value < $prop['minimum']) {
                $this->errors[] = "参数 '{$key}' 不能小于 {$prop['minimum']}";
            }
            if (isset($prop['maximum']) && is_numeric($value) && $value > $prop['maximum']) {
                $this->errors[] = "参数 '{$key}' 不能大于 {$prop['maximum']}";
            }

            // 字符串长度
            if (isset($prop['maxLength']) && is_string($value) && mb_strlen($value) > $prop['maxLength']) {
                $this->errors[] = "参数 '{$key}' 长度不能超过 {$prop['maxLength']} 字符";
            }

            // 数组元素数量
            if (isset($prop['maxItems']) && is_array($value) && count($value) > $prop['maxItems']) {
                $this->errors[] = "参数 '{$key}' 元素数量不能超过 {$prop['maxItems']}";
            }
        }
    }

    private function validateBusinessRules(array $params, array $schema): void
    {
        // 子类可覆盖，添加业务特定校验
    }

    /**
     * 清洗参数，防止注入
     */
    private function sanitize(array $params, array $schema): array
    {
        $properties = $schema['properties'] ?? [];

        foreach ($params as $key => $value) {
            if (!isset($properties[$key])) {
                continue;
            }

            if ($properties[$key]['type'] === 'string' && is_string($value)) {
                // 去除首尾空白
                $params[$key] = trim($value);
                // 防止 XSS（如果结果会展示）
                $params[$key] = htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
            }
        }

        return $params;
    }
}
```

### 2.3 SQL 注入防护

对于数据库查询类工具，必须使用参数化查询：

```php
<?php

namespace App\Services\Agent\Tools;

class DatabaseQueryTool extends BaseTool
{
    public function execute(array $params): ToolResult
    {
        $table = $params['table'];
        $conditions = $params['conditions'] ?? [];

        // 白名单表名，防止 SQL 注入
        $allowedTables = ['users', 'orders', 'products'];
        if (!in_array($table, $allowedTables, true)) {
            return ToolResult::error("不允许查询表：{$table}");
        }

        // 使用 Laravel 查询构造器，自动参数化
        $query = \DB::table($table);

        foreach ($conditions as $condition) {
            $column = $condition['column'];
            $operator = $condition['operator'];
            $value = $condition['value'];

            // 白名单操作符
            $allowedOperators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE'];
            if (!in_array($operator, $allowedOperators, true)) {
                return ToolResult::error("不支持的操作符：{$operator}");
            }

            $query->where($column, $operator, $value);
        }

        $results = $query->limit(100)->get();

        return ToolResult::success($results->toArray());
    }
}
```

## 三、错误分类

### 3.1 为什么需要错误分类

不同类型的错误需要不同的处理策略。把所有错误都当作一种情况处理，会导致：
- 可重试的错误没有重试
- 不可重试的错误反复重试浪费资源
- 用户看到的错误信息不友好

### 3.2 错误分类体系

```php
<?php

namespace App\Services\Agent\Exceptions;

enum ToolErrorType: string
{
    // 参数错误 —— 不可重试，需要 LLM 修正参数
    case VALIDATION_ERROR = 'validation_error';
    case INVALID_PARAMS = 'invalid_params';
    case MISSING_PARAMS = 'missing_params';

    // 资源错误 —— 部分可重试
    case NOT_FOUND = 'not_found';
    case PERMISSION_DENIED = 'permission_denied';

    // 服务错误 —— 可重试
    case TIMEOUT = 'timeout';
    case RATE_LIMITED = 'rate_limited';
    case SERVICE_UNAVAILABLE = 'service_unavailable';
    case NETWORK_ERROR = 'network_error';

    // 内部错误 —— 需要人工介入
    case INTERNAL_ERROR = 'internal_error';
    case UNKNOWN = 'unknown';

    /**
     * 是否可重试
     */
    public function isRetryable(): bool
    {
        return match ($this) {
            self::TIMEOUT,
            self::RATE_LIMITED,
            self::SERVICE_UNAVAILABLE,
            self::NETWORK_ERROR => true,
            default => false,
        };
    }

    /**
     * 是否需要 LLM 重新生成参数
     */
    public function requiresParam修正(): bool
    {
        return match ($this) {
            self::VALIDATION_ERROR,
            self::INVALID_PARAMS,
            self::MISSING_PARAMS => true,
            default => false,
        };
    }

    /**
     * HTTP 状态码映射
     */
    public function toHttpStatusCode(): int
    {
        return match ($this) {
            self::VALIDATION_ERROR,
            self::INVALID_PARAMS,
            self::MISSING_PARAMS => 400,
            self::NOT_FOUND => 404,
            self::PERMISSION_DENIED => 403,
            self::RATE_LIMITED => 429,
            self::TIMEOUT,
            self::SERVICE_UNAVAILABLE => 503,
            default => 500,
        };
    }
}
```

### 3.3 统一错误结果

```php
<?php

namespace App\Services\Agent\Tools;

use App\Services\Agent\Exceptions\ToolErrorType;

class ToolResult
{
    private bool $success;
    private mixed $data;
    private ?ToolErrorType $errorType;
    private ?string $errorMessage;
    private array $metadata;

    private function __construct(
        bool $success,
        mixed $data = null,
        ?ToolErrorType $errorType = null,
        ?string $errorMessage = null,
        array $metadata = []
    ) {
        $this->success = $success;
        $this->data = $data;
        $this->errorType = $errorType;
        $this->errorMessage = $errorMessage;
        $this->metadata = $metadata;
    }

    public static function success(mixed $data, array $metadata = []): self
    {
        return new self(true, $data, metadata: $metadata);
    }

    public static function error(
        ToolErrorType $type,
        string $message,
        array $metadata = []
    ): self {
        return new self(false, errorType: $type, errorMessage: $message, metadata: $metadata);
    }

    /**
     * 转换为 LLM 可理解的文本
     */
    public function toLLMResponse(): string
    {
        if ($this->success) {
            return json_encode([
                'status' => 'success',
                'data' => $this->data,
            ], JSON_UNESCAPED_UNICODE);
        }

        return json_encode([
            'status' => 'error',
            'error_type' => $this->errorType->value,
            'message' => $this->errorMessage,
            'retryable' => $this->errorType->isRetryable(),
            'hint' => $this->getErrorHint(),
        ], JSON_UNESCAPED_UNICODE);
    }

    private function getErrorHint(): string
    {
        return match ($this->errorType) {
            ToolErrorType::VALIDATION_ERROR => '请检查参数格式后重试',
            ToolErrorType::NOT_FOUND => '资源不存在，请确认参数',
            ToolErrorType::RATE_LIMITED => '请求过于频繁，请稍后重试',
            ToolErrorType::TIMEOUT => '服务响应超时，请稍后重试',
            ToolErrorType::PERMISSION_DENIED => '没有权限执行此操作',
            default => '发生未知错误',
        };
    }

    public function isSuccess(): bool { return $this->success; }
    public function getErrorType(): ?ToolErrorType { return $this->errorType; }
    public function getData(): mixed { return $this->data; }
}
```

## 四、重试策略

### 4.1 重试策略设计

不是所有错误都值得重试。我们需要一个智能的重试策略：

```php
<?php

namespace App\Services\Agent\Retry;

use App\Services\Agent\Exceptions\ToolErrorType;
use App\Services\Agent\Tools\ToolResult;
use Illuminate\Support\Facades\Log;

class RetryStrategy
{
    private int $maxRetries;
    private int $baseDelayMs;
    private float $backoffMultiplier;
    private int $maxDelayMs;

    public function __construct(
        int $maxRetries = 3,
        int $baseDelayMs = 1000,
        float $backoffMultiplier = 2.0,
        int $maxDelayMs = 30000
    ) {
        $this->maxRetries = $maxRetries;
        $this->baseDelayMs = $baseDelayMs;
        $this->backoffMultiplier = $backoffMultiplier;
        $this->maxDelayMs = $maxDelayMs;
    }

    /**
     * 执行带重试的工具调用
     */
    public function execute(callable $action): ToolResult
    {
        $lastResult = null;
        $attempt = 0;

        while ($attempt <= $this->maxRetries) {
            try {
                $result = $action();

                if ($result->isSuccess()) {
                    if ($attempt > 0) {
                        Log::info("工具调用在第 {$attempt} 次重试后成功");
                    }
                    return $result;
                }

                $errorType = $result->getErrorType();

                // 不可重试的错误，直接返回
                if (!$errorType->isRetryable()) {
                    Log::info("工具调用失败（不可重试）: {$errorType->value}");
                    return $result;
                }

                $lastResult = $result;

                // Rate Limited 特殊处理
                if ($errorType === ToolErrorType::RATE_LIMITED) {
                    $delay = $this->getRateLimitDelay($result);
                } else {
                    $delay = $this->calculateDelay($attempt);
                }

                Log::warning("工具调用失败，{$delay}ms 后重试 ({$attempt}/{$this->maxRetries})", [
                    'error_type' => $errorType->value,
                    'delay_ms' => $delay,
                ]);

                usleep($delay * 1000);

            } catch (\Exception $e) {
                Log::error("工具调用异常: {$e->getMessage()}");

                if ($attempt >= $this->maxRetries) {
                    return ToolResult::error(
                        ToolErrorType::INTERNAL_ERROR,
                        "工具调用异常: {$e->getMessage()}"
                    );
                }

                $delay = $this->calculateDelay($attempt);
                usleep($delay * 1000);
            }

            $attempt++;
        }

        return $lastResult ?? ToolResult::error(
            ToolErrorType::INTERNAL_ERROR,
            '超过最大重试次数'
        );
    }

    /**
     * 指数退避计算
     */
    private function calculateDelay(int $attempt): int
    {
        $delay = $this->baseDelayMs * pow($this->backoffMultiplier, $attempt);

        // 添加随机抖动，避免惊群效应
        $jitter = $delay * 0.1 * (mt_rand(0, 200) / 100 - 1);
        $delay = $delay + $jitter;

        return (int) min($delay, $this->maxDelayMs);
    }

    /**
     * 从 Rate Limit 响应中提取重试时间
     */
    private function getRateLimitDelay(ToolResult $result): int
    {
        $metadata = $result->metadata ?? [];
        $retryAfter = $metadata['retry_after'] ?? null;

        if ($retryAfter) {
            return (int) $retryAfter * 1000;
        }

        // 默认 60 秒
        return 60000;
    }
}
```

### 4.2 不同错误类型的重试配置

```php
<?php

namespace App\Services\Agent\Retry;

use App\Services\Agent\Exceptions\ToolErrorType;

class RetryConfigFactory
{
    /**
     * 根据工具类型获取重试配置
     */
    public static function forTool(string $toolName): RetryStrategy
    {
        return match ($toolName) {
            // API 调用类工具：适度重试
            'search_web', 'get_weather' => new RetryStrategy(
                maxRetries: 3,
                baseDelayMs: 1000,
                backoffMultiplier: 2.0
            ),

            // 数据库操作：快速失败
            'query_database' => new RetryStrategy(
                maxRetries: 1,
                baseDelayMs: 500
            ),

            // 文件操作：不重试
            'read_file', 'write_file' => new RetryStrategy(
                maxRetries: 0
            ),

            // 第三方 API：较长等待
            'call_external_api' => new RetryStrategy(
                maxRetries: 5,
                baseDelayMs: 2000,
                backoffMultiplier: 3.0,
                maxDelayMs: 60000
            ),

            // 默认配置
            default => new RetryStrategy()
        };
    }
}
```

## 五、降级方案

### 5.1 降级策略层次

```
正常调用 → 重试 → 缓存降级 → 简化降级 → 兜底降级
```

```php
<?php

namespace App\Services\Agent\Fallback;

use App\Services\Agent\Tools\ToolResult;
use App\Services\Agent\Exceptions\ToolErrorType;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class FallbackChain
{
    private array $fallbacks = [];

    /**
     * 注册降级方案
     */
    public function add(FallbackStrategy $strategy): self
    {
        $this->fallbacks[] = $strategy;
        return $this;
    }

    /**
     * 执行降级链
     */
    public function execute(string $toolName, array $params, ToolResult $failedResult): ToolResult
    {
        foreach ($this->fallbacks as $index => $fallback) {
            if (!$fallback->canHandle($toolName, $failedResult)) {
                continue;
            }

            Log::info("执行降级方案 #{$index}: " . get_class($fallback), [
                'tool' => $toolName,
                'strategy' => $fallback->getName(),
            ]);

            $result = $fallback->execute($toolName, $params);

            if ($result->isSuccess()) {
                Log::info("降级方案 #{$index} 成功");
                return $result;
            }
        }

        // 所有降级方案都失败，返回兜底结果
        return $this->getUltimateFallback($toolName, $failedResult);
    }

    private function getUltimateFallback(string $toolName, ToolResult $failedResult): ToolResult
    {
        return ToolResult::error(
            ToolErrorType::SERVICE_UNAVAILABLE,
            "工具 {$toolName} 暂时不可用，请稍后再试"
        );
    }
}

/**
 * 缓存降级策略
 */
class CacheFallback implements FallbackStrategy
{
    public function getName(): string
    {
        return 'cache_fallback';
    }

    public function canHandle(string $toolName, ToolResult $failedResult): bool
    {
        $cacheableTools = ['get_weather', 'search_web', 'get_news'];
        return in_array($toolName, $cacheableTools);
    }

    public function execute(string $toolName, array $params): ToolResult
    {
        $cacheKey = "tool_cache:{$toolName}:" . md5(json_encode($params));
        $cached = Cache::get($cacheKey);

        if ($cached) {
            Log::info("使用缓存降级: {$toolName}");
            $data = json_decode($cached, true);
            $data['_from_cache'] = true;
            $data['_cache_warning'] = '数据来自缓存，可能不是最新';
            return ToolResult::success($data, ['source' => 'cache']);
        }

        return ToolResult::error(
            ToolErrorType::NOT_FOUND,
            '缓存中无可用数据'
        );
    }
}

/**
 * 简化降级策略
 */
class SimplifiedFallback implements FallbackStrategy
{
    public function getName(): string
    {
        return 'simplified_fallback';
    }

    public function canHandle(string $toolName, ToolResult $failedResult): bool
    {
        return true; // 通用降级
    }

    public function execute(string $toolName, array $params): ToolResult
    {
        // 返回简化结果，告诉 LLM 工具不可用但提供替代信息
        return ToolResult::success([
            'simplified' => true,
            'message' => "工具 {$toolName} 暂时不可用，已返回简化结果",
            'suggestion' => '建议用户直接访问相关网站获取最新信息',
        ], ['source' => 'simplified']);
    }
}
```

### 5.2 完整的工具执行器

将所有组件串联起来：

```php
<?php

namespace App\Services\Agent;

use App\Services\Agent\Tools\BaseTool;
use App\Services\Agent\Tools\ToolResult;
use App\Services\Agent\Validation\ToolParameterValidator;
use App\Services\Agent\Retry\RetryStrategy;
use App\Services\Agent\Fallback\FallbackChain;
use Illuminate\Support\Facades\Log;

class ToolExecutor
{
    private ToolParameterValidator $validator;
    private FallbackChain $fallbackChain;
    private array $retryConfigs = [];

    public function __construct(
        ToolParameterValidator $validator,
        FallbackChain $fallbackChain
    ) {
        $this->validator = $validator;
        $this->fallbackChain = $fallbackChain;
    }

    /**
     * 执行工具调用
     */
    public function execute(BaseTool $tool, array $params): ToolResult
    {
        $toolName = $tool->getName();
        $startTime = microtime(true);

        Log::info("执行工具: {$toolName}", ['params' => $params]);

        // 1. 参数校验
        try {
            $schema = [
                'properties' => $tool->getParameters(),
                'required' => $tool->getRequiredFields(),
            ];
            $validatedParams = $this->validator->validate($params, $schema);
        } catch (\App\Exceptions\ToolValidationException $e) {
            Log::warning("工具参数校验失败: {$toolName}", ['errors' => $e->getErrors()]);
            return ToolResult::error(
                ToolErrorType::VALIDATION_ERROR,
                '参数校验失败: ' . implode('; ', $e->getErrors())
            );
        }

        // 2. 带重试的执行
        $retryStrategy = $this->retryConfigs[$toolName] ?? new RetryStrategy();

        $result = $retryStrategy->execute(function () use ($tool, $validatedParams) {
            return $tool->execute($validatedParams);
        });

        // 3. 如果失败，尝试降级
        if (!$result->isSuccess()) {
            $result = $this->fallbackChain->execute($toolName, $validatedParams, $result);
        }

        // 4. 记录执行结果
        $duration = (microtime(true) - $startTime) * 1000;
        Log::info("工具执行完成: {$toolName}", [
            'success' => $result->isSuccess(),
            'duration_ms' => round($duration, 2),
        ]);

        return $result;
    }

    /**
     * 注册工具特定的重试配置
     */
    public function setRetryConfig(string $toolName, RetryStrategy $config): void
    {
        $this->retryConfigs[$toolName] = $config;
    }
}
```

### 5.3 在 Laravel 中注册服务

```php
<?php

namespace App\Providers;

use App\Services\Agent\ToolExecutor;
use App\Services\Agent\Validation\ToolParameterValidator;
use App\Services\Agent\Fallback\FallbackChain;
use App\Services\Agent\Fallback\CacheFallback;
use App\Services\Agent\Fallback\SimplifiedFallback;
use Illuminate\Support\ServiceProvider;

class AgentServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ToolExecutor::class, function ($app) {
            $validator = new ToolParameterValidator();

            $fallbackChain = new FallbackChain();
            $fallbackChain->add(new CacheFallback());
            $fallbackChain->add(new SimplifiedFallback());

            return new ToolExecutor($validator, $fallbackChain);
        });
    }
}
```

## 六、踩坑记录

### 6.1 LLM 生成的 JSON 格式错误

**问题**：LLM 有时生成的 JSON 不合法，比如尾部多一个逗号。

**解决**：使用宽松的 JSON 解析器：

```php
function parseLLMJson(string $json): ?array
{
    // 移除可能的 markdown 代码块标记
    $json = preg_replace('/^```json?\s*/m', '', $json);
    $json = preg_replace('/\s*```$/m', '', $json);

    // 移除尾部逗号（LLM 常见错误）
    $json = preg_replace('/,\s*([\]}])/', '$1', $json);

    $decoded = json_decode($json, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        Log::warning("JSON 解析失败", [
            'error' => json_last_error_msg(),
            'input' => substr($json, 0, 500),
        ]);
        return null;
    }

    return $decoded;
}
```

### 6.2 工具描述过长导致 Token 浪费

**问题**：工具太多时，描述会占用大量 context window。

**解决**：使用工具分组和动态加载：

```php
class ToolRegistry
{
    private array $tools = [];
    private array $categories = [];

    /**
     * 按场景加载工具子集
     */
    public function getToolsForContext(string $context): array
    {
        $category = $this->categories[$context] ?? 'default';
        return array_filter($this->tools, fn($tool) => $tool->getCategory() === $category);
    }
}
```

### 6.3 并发调用时的竞态条件

**问题**：多个 Agent 同时调用同一个工具，可能出现竞态。

**解决**：使用分布式锁：

```php
public function executeWithLock(BaseTool $tool, array $params): ToolResult
{
    $lockKey = "tool_lock:{$tool->getName()}:" . md5(json_encode($params));

    return Cache::lock($lockKey, 30)->block(5, function () use ($tool, $params) {
        return $this->execute($tool, $params);
    });
}
```

## 总结

一个生产可用的 AI Agent 工具系统，需要五个层次的工程保障：

1. **定义规范**：清晰的 JSON Schema、详细的描述、明确的边界
2. **参数校验**：分层校验（类型→必填→约束→业务）、防注入
3. **错误分类**：区分可重试/不可重试、参数错误/服务错误
4. **重试策略**：指数退避、抖动、按工具类型差异化配置
5. **降级方案**：缓存降级→简化降级→兜底降级

这五个环节缺一不可。跳过任何一步，都会在生产环境中以 Bug 的形式找上门来。

工具系统是 Agent 的手脚。手脚不稳，大脑再聪明也没用。
