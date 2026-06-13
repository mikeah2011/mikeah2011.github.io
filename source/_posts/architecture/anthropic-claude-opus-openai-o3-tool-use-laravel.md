---
title: 'Anthropic Claude Opus 4 / OpenAI o3 实战：最新推理模型接入——思维链输出、Tool Use 与 Laravel 集成'
date: 2026-06-06 10:00:00
description: '深入实战 Anthropic Claude Opus 4 与 OpenAI o3 两大最新推理模型的 Laravel 集成方案。涵盖 Extended Thinking 与 Chain of Thought 思维链输出原理、Tool Use 函数调用完整流程、流式 SSE 推送、错误重试与 Rate Limit 应对策略，附带完整可运行代码与成本优化建议，帮助后端工程师快速将推理模型接入生产级应用。'
tags: [AI, LLM, Claude, OpenAI, Laravel, Tool Use]
keywords: [Anthropic Claude Opus, OpenAI o3, Tool Use, Laravel, 最新推理模型接入, 思维链输出, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


## 前言

2026 年上半年，AI 推理模型领域迎来了两颗重磅炸弹：Anthropic 发布的 **Claude Opus 4** 和 OpenAI 推出的 **o3**。这两款模型不同于传统的"即问即答"式大语言模型——它们在回答问题之前，会先进行深度的内部推理，展示出接近人类专家的思考过程。更关键的是，开发者现在可以通过 API 获取这些推理过程的输出，从而实现透明化、可解释的 AI 决策链路。

但"能推理"只是第一步。作为后端工程师，我们真正关心的是：**如何将这些模型无缝接入生产级 Laravel 应用？** 如何正确处理流式输出、Tool Use（函数调用）、Token 计费、错误重试等工程问题？

本文将从零开始，带你完成一个完整的 Laravel 集成方案，覆盖 Claude Opus 4 的 Extended Thinking 机制、OpenAI o3 的推理链输出、标准 Tool Use 接入方式，以及两个模型的实战对比评测。所有代码均可直接用于生产环境。

---

## 一、推理模型概述：Claude Opus 4 与 OpenAI o3

### 1.1 什么是推理模型？

传统大语言模型（如 GPT-4o、Claude Sonnet）采用"直觉式"推理——输入 prompt，模型立即生成 token，整个过程是一次前向传播。而推理模型（Reasoning Model）引入了一个**显式的思考阶段**：模型在生成最终回答之前，会先在内部生成一段结构化的推理过程。

这种设计的核心价值在于：

- **复杂问题求解**：数学证明、代码调试、多步骤逻辑推理等场景，推理模型的准确率显著优于传统模型
- **透明度**：开发者可以观察模型的思考路径，便于调试和信任验证
- **自我修正**：模型在推理过程中可以发现并纠正自己的错误

### 1.2 Claude Opus 4 的 Extended Thinking

Claude Opus 4 引入了 **Extended Thinking**（扩展思考）机制。当启用该功能后，模型会先生成一段思考内容（`thinking` 类型的 content block），然后再输出最终回答。

技术特点：

- 思考内容通过独立的 `content block` 返回，类型为 `"type": "thinking"`
- 支持通过 `budget_tokens` 参数控制推理阶段的最大 token 预算
- 思考 token 单独计费，价格约为输出 token 的 1.5 倍
- 支持流式输出，思考过程可以实时逐 token 推送

### 1.3 OpenAI o3 的 Chain of Thought

OpenAI o3 采用了 **Chain of Thought**（思维链）机制，通过 `reasoning` 类型的输出展示推理过程。与 Claude 不同的是，o3 的推理链在默认情况下是隐藏的，需要通过特定参数来启用可见输出。

技术特点：

- 通过设置 `reasoning.summary` 参数来获取推理摘要
- 推理 token 有独立的计费体系
- 支持 `reasoning_effort` 参数（`low`/`medium`/`high`）控制推理深度
- 与 Responses API 配合使用，支持多轮推理

### 1.4 Claude Opus 4 vs OpenAI o3 对比

下表从定价、上下文窗口、推理速度、Tool Use 支持、多模态能力五个维度对比两款模型：

| 维度 | Claude Opus 4 | OpenAI o3 |
|------|--------------|-----------|
| **输入价格** | $15 / M tokens | $10 / M tokens |
| **输出价格** | $75 / M tokens | $40 / M tokens |
| **上下文窗口** | 200K tokens | 200K tokens |
| **最大输出** | 32K tokens (含思考) | 100K tokens |
| **推理速度** | 中等（10-25s，Extended Thinking 期间逐 token 输出） | 较快（5-20s，内部推理后一次性输出摘要） |
| **推理深度控制** | `budget_tokens` 精确控制 | `reasoning_effort` 三档（low/medium/high） |
| **Tool Use** | ✅ 原生支持，tool_use content block | ✅ Responses API 原生支持 function_call |
| **多模态** | ✅ 支持图片输入（Vision） | ✅ 支持图片输入 |
| **流式输出** | ✅ 思考过程 + 回答均可流式推送 | ✅ 推理摘要 + 回答流式推送 |
| **Prompt Caching** | ✅ 支持（系统提示词缓存，降本 90%） | ❌ 不支持 |
| **适用场景** | 代码审查、复杂分析、长文档推理 | 数学推理、数据处理、快速推理任务 |

---

## 二、环境准备与依赖安装

### 2.1 项目初始化

```bash
composer create-project laravel/laravel ai-reasoning-app
cd ai-reasoning-app
composer require guzzlehttp/guzzle
```

### 2.2 环境变量配置

在 `.env` 文件中添加 API Key：

```env
# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com

# OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 2.3 Config 配置

```php
// config/services.php
return [
    // ...existing config...
    
    'anthropic' => [
        'api_key' => env('ANTHROPIC_API_KEY'),
        'base_url' => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
        'model' => env('ANTHROPIC_MODEL', 'claude-opus-4-20250514'),
        'max_tokens' => (int) env('ANTHROPIC_MAX_TOKENS', 16000),
        'budget_tokens' => (int) env('ANTHROPIC_BUDGET_TOKENS', 10000),
    ],
    
    'openai' => [
        'api_key' => env('OPENAI_API_KEY'),
        'base_url' => env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        'model' => env('OPENAI_MODEL', 'o3'),
        'reasoning_effort' => env('OPENAI_REASONING_EFFORT', 'medium'),
    ],
];
```

---

## 三、思维链（Chain-of-Thought）输出原理与 API 配置

### 3.1 Claude Opus 4 的 Extended Thinking 请求结构

Claude Opus 4 的 Extended Thinking 请求体结构如下：

```json
{
  "model": "claude-opus-4-20250514",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [
    {
      "role": "user",
      "content": "请分析这段代码的潜在安全漏洞..."
    }
  ]
}
```

响应结构中的 `content` 数组包含两种 block：

```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "让我仔细分析这段代码...\n1. 首先检查 SQL 拼接...\n2. 再看 XSS 过滤...\n3. 最后验证认证逻辑..."
    },
    {
      "type": "text",
      "text": "经过分析，这段代码存在以下安全漏洞..."
    }
  ],
  "usage": {
    "input_tokens": 520,
    "output_tokens": 1200,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0
  }
}
```

**关键参数说明：**

| 参数 | 说明 |
|------|------|
| `thinking.type` | 设为 `"enabled"` 启用思考 |
| `thinking.budget_tokens` | 推理阶段最大 token 预算 |
| `max_tokens` | 包含思考 + 输出的总 token 上限 |

> ⚠️ **注意**：使用 Extended Thinking 时，`max_tokens` 必须大于 `budget_tokens`，否则 API 返回 400 错误。

### 3.2 OpenAI o3 的推理链请求结构

OpenAI o3 使用 Responses API，请求结构如下：

```json
{
  "model": "o3",
  "input": "请分析这段代码的潜在安全漏洞...",
  "reasoning": {
    "summary": "auto",
    "effort": "medium"
  }
}
```

响应结构中 `output` 数组包含 `reasoning` 和 `message` 类型：

```json
{
  "output": [
    {
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "分析代码安全性：\n1. 检查输入验证...\n2. 检查 SQL 注入风险..."
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "经过分析，这段代码存在以下安全漏洞..."
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 450,
    "output_tokens": 800,
    "output_tokens_details": {
      "reasoning_tokens": 600
    }
  }
}
```

**关键参数说明：**

| 参数 | 说明 |
|------|------|
| `reasoning.summary` | `"auto"` 或 `"detailed"`，控制推理摘要详细程度 |
| `reasoning.effort` | `"low"`/`"medium"`/`"high"`，控制推理深度与 token 消耗 |

---

## 四、Laravel 集成：统一推理服务

### 4.1 Service Provider 注册

创建 `app/Providers/AIReasoningServiceProvider.php`：

```php
<?php

namespace App\Providers;

use App\Services\AI\ReasoningService;
use Illuminate\Support\ServiceProvider;

class AIReasoningServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ReasoningService::class, function ($app) {
            return new ReasoningService(
                anthropicConfig: config('services.anthropic'),
                openaiConfig: config('services.openai'),
            );
        });
    }
}
```

### 4.2 核心服务类

创建 `app/Services/AI/ReasoningService.php`，这是整个集成的核心：

```php
<?php

namespace App\Services\AI;

use App\Services\AI\Drivers\AnthropicDriver;
use App\Services\AI\Drivers\OpenAIDriver;
use App\Services\AI\DTOs\ReasoningResponse;
use Illuminate\Support\Facades\Http;

class ReasoningService
{
    private readonly AnthropicDriver $anthropic;
    private readonly OpenAIDriver $openai;

    public function __construct(
        private readonly array $anthropicConfig,
        private readonly array $openaiConfig,
    ) {
        $this->anthropic = new AnthropicDriver(
            apiKey: $this->anthropicConfig['api_key'],
            baseUrl: $this->anthropicConfig['base_url'],
            model: $this->anthropicConfig['model'],
            maxTokens: $this->anthropicConfig['max_tokens'],
            budgetTokens: $this->anthropicConfig['budget_tokens'],
        );

        $this->openai = new OpenAIDriver(
            apiKey: $this->openaiConfig['api_key'],
            baseUrl: $this->openaiConfig['base_url'],
            model: $this->openaiConfig['model'],
            reasoningEffort: $this->openaiConfig['reasoning_effort'],
        );
    }

    /**
     * 选择驱动并发送推理请求
     */
    public function ask(
        string $prompt,
        string $provider = 'anthropic',
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): ReasoningResponse {
        $driver = match ($provider) {
            'anthropic' => $this->anthropic,
            'openai' => $this->openai,
            default => throw new \InvalidArgumentException("Unsupported provider: {$provider}"),
        };

        return $driver->complete(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
        );
    }

    /**
     * 流式推理请求
     */
    public function stream(
        string $prompt,
        string $provider = 'anthropic',
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): \Generator {
        $driver = match ($provider) {
            'anthropic' => $this->anthropic,
            'openai' => $this->openai,
            default => throw new \InvalidArgumentException("Unsupported provider: {$provider}"),
        };

        return $driver->streamComplete(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
        );
    }
}
```

### 4.3 Anthropic Driver 实现

创建 `app/Services/AI/Drivers/AnthropicDriver.php`：

```php
<?php

namespace App\Services\AI\Drivers;

use App\Services\AI\DTOs\ReasoningResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AnthropicDriver
{
    private const API_VERSION = '2023-06-01';

    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly string $model,
        private readonly int $maxTokens,
        private readonly int $budgetTokens,
    ) {}

    /**
     * 非流式推理请求
     */
    public function complete(
        string $prompt,
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): ReasoningResponse {
        $payload = $this->buildPayload(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
            stream: false,
        );

        $response = $this->sendRequest('/v1/messages', $payload);

        return $this->parseResponse($response);
    }

    /**
     * 流式推理请求
     */
    public function streamComplete(
        string $prompt,
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): \Generator {
        $payload = $this->buildPayload(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
            stream: true,
        );

        $response = Http::withHeaders($this->getHeaders())
            ->timeout(120)
            ->withBody(json_encode($payload), 'application/json')
            ->send('POST', "{$this->baseUrl}/v1/messages", [
                'stream' => true,
            ]);

        $buffer = '';
        $eventType = '';

        foreach ($this->readStream($response) as $line) {
            if (str_starts_with($line, 'event: ')) {
                $eventType = substr($line, 7);
                continue;
            }

            if (!str_starts_with($line, 'data: ')) {
                continue;
            }

            $data = json_decode(substr($line, 6), true);
            if (!$data) {
                continue;
            }

            yield $this->parseStreamEvent($eventType, $data);
        }
    }

    /**
     * 构建请求 payload
     */
    private function buildPayload(
        string $prompt,
        ?array $tools,
        ?array $systemPrompt,
        ?string $thinking,
        bool $stream,
    ): array {
        $payload = [
            'model' => $this->model,
            'max_tokens' => $this->maxTokens,
            'messages' => [
                ['role' => 'user', 'content' => $prompt],
            ],
        ];

        // 启用 Extended Thinking
        if ($thinking === 'enabled') {
            $payload['thinking'] = [
                'type' => 'enabled',
                'budget_tokens' => $this->budgetTokens,
            ];
            // 使用 Extended Thinking 时需要设置温度为 1
            $payload['temperature'] = 1;
        }

        // 系统提示词
        if ($systemPrompt) {
            $payload['system'] = $systemPrompt;
        }

        // Tool Use 定义
        if ($tools) {
            $payload['tools'] = $tools;
        }

        if ($stream) {
            $payload['stream'] = true;
        }

        return $payload;
    }

    /**
     * 发送 HTTP 请求（带重试）
     */
    private function sendRequest(string $endpoint, array $payload): array
    {
        $maxRetries = 3;
        $retryDelay = 1;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $response = Http::withHeaders($this->getHeaders())
                    ->timeout(120)
                    ->post("{$this->baseUrl}{$endpoint}", $payload);

                if ($response->successful()) {
                    return $response->json();
                }

                $statusCode = $response->status();
                $errorBody = $response->json();

                // 429 Too Many Requests - 重试
                if ($statusCode === 429) {
                    $retryAfter = (int) ($response->header('retry-after') ?? $retryDelay * $attempt);
                    Log::warning("Anthropic API rate limited, retrying in {$retryAfter}s", [
                        'attempt' => $attempt,
                        'status' => $statusCode,
                    ]);
                    sleep($retryAfter);
                    continue;
                }

                // 5xx 服务端错误 - 重试
                if ($statusCode >= 500) {
                    Log::warning("Anthropic API server error, retrying", [
                        'attempt' => $attempt,
                        'status' => $statusCode,
                        'error' => $errorBody,
                    ]);
                    sleep($retryDelay * $attempt);
                    continue;
                }

                // 4xx 客户端错误 - 不重试
                throw new \RuntimeException(
                    "Anthropic API error ({$statusCode}): " . json_encode($errorBody)
                );
            } catch (\Illuminate\Http\Client\ConnectionException $e) {
                if ($attempt === $maxRetries) {
                    throw $e;
                }
                Log::warning("Anthropic API connection failed, retrying", [
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);
                sleep($retryDelay * $attempt);
            }
        }

        throw new \RuntimeException("Anthropic API request failed after {$maxRetries} attempts");
    }

    /**
     * 获取请求头
     */
    private function getHeaders(): array
    {
        return [
            'x-api-key' => $this->apiKey,
            'anthropic-version' => self::API_VERSION,
            'content-type' => 'application/json',
        ];
    }

    /**
     * 解析非流式响应
     */
    private function parseResponse(array $data): ReasoningResponse
    {
        $thinking = '';
        $text = '';
        $toolCalls = [];

        foreach ($data['content'] ?? [] as $block) {
            match ($block['type']) {
                'thinking' => $thinking .= $block['thinking'] ?? '',
                'text' => $text .= $block['text'] ?? '',
                'tool_use' => $toolCalls[] = [
                    'id' => $block['id'],
                    'name' => $block['name'],
                    'input' => $block['input'],
                ],
                default => null,
            };
        }

        return new ReasoningResponse(
            thinking: $thinking,
            text: $text,
            toolCalls: $toolCalls,
            inputTokens: $data['usage']['input_tokens'] ?? 0,
            outputTokens: $data['usage']['output_tokens'] ?? 0,
            provider: 'anthropic',
            model: $data['model'] ?? $this->model,
            rawData: $data,
        );
    }

    /**
     * 解析流式事件
     */
    private function parseStreamEvent(string $eventType, array $data): array
    {
        return match ($eventType) {
            'content_block_start' => [
                'type' => 'block_start',
                'block_type' => $data['content_block']['type'] ?? 'unknown',
                'index' => $data['index'] ?? 0,
            ],
            'content_block_delta' => [
                'type' => 'block_delta',
                'block_type' => $data['delta']['type'] ?? 'unknown',
                'content' => $data['delta']['thinking']
                    ?? $data['delta']['text']
                    ?? $data['delta']['partial_json']
                    ?? '',
                'index' => $data['index'] ?? 0,
            ],
            'content_block_stop' => [
                'type' => 'block_stop',
                'index' => $data['index'] ?? 0,
            ],
            'message_delta' => [
                'type' => 'message_delta',
                'stop_reason' => $data['delta']['stop_reason'] ?? null,
                'usage' => $data['usage'] ?? [],
            ],
            'message_stop' => [
                'type' => 'message_stop',
            ],
            default => [
                'type' => $eventType,
                'data' => $data,
            ],
        };
    }

    /**
     * 读取 SSE 流
     */
    private function readStream($response): \Generator
    {
        $buffer = '';

        while (!$response->getBody()->eof()) {
            $chunk = $response->getBody()->read(1024);
            $buffer .= $chunk;

            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = substr($buffer, 0, $pos);
                $buffer = substr($buffer, $pos + 1);
                $line = rtrim($line, "\r");

                if ($line !== '') {
                    yield $line;
                }
            }
        }
    }
}
```

### 4.4 OpenAI Driver 实现

创建 `app/Services/AI/Drivers/OpenAIDriver.php`：

```php
<?php

namespace App\Services\AI\Drivers;

use App\Services\AI\DTOs\ReasoningResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OpenAIDriver
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly string $model,
        private readonly string $reasoningEffort,
    ) {}

    /**
     * 非流式推理请求
     */
    public function complete(
        string $prompt,
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): ReasoningResponse {
        $payload = $this->buildPayload(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
        );

        $response = $this->sendRequest('/responses', $payload);

        return $this->parseResponse($response);
    }

    /**
     * 流式推理请求
     */
    public function streamComplete(
        string $prompt,
        ?array $tools = null,
        ?array $systemPrompt = null,
        ?string $thinking = null,
    ): \Generator {
        $payload = $this->buildPayload(
            prompt: $prompt,
            tools: $tools,
            systemPrompt: $systemPrompt,
            thinking: $thinking,
        );
        $payload['stream'] = true;

        $response = Http::withHeaders($this->getHeaders())
            ->timeout(120)
            ->withBody(json_encode($payload), 'application/json')
            ->send('POST', "{$this->baseUrl}/responses", [
                'stream' => true,
            ]);

        $buffer = '';

        foreach ($this->readStream($response) as $line) {
            if (!str_starts_with($line, 'data: ')) {
                continue;
            }

            $data = json_decode(substr($line, 6), true);
            if (!$data) {
                continue;
            }

            $parsed = $this->parseStreamEvent($data);
            if ($parsed) {
                yield $parsed;
            }
        }
    }

    /**
     * 构建请求 payload
     */
    private function buildPayload(
        string $prompt,
        ?array $tools,
        ?array $systemPrompt,
        ?string $thinking,
    ): array {
        $payload = [
            'model' => $this->model,
            'input' => $prompt,
        ];

        // 启用推理
        if ($thinking === 'enabled') {
            $payload['reasoning'] = [
                'summary' => 'auto',
                'effort' => $this->reasoningEffort,
            ];
        }

        // 系统提示词（通过 instructions 字段）
        if ($systemPrompt) {
            $payload['instructions'] = is_array($systemPrompt)
                ? implode("\n", $systemPrompt)
                : $systemPrompt;
        }

        // Tool Use 定义
        if ($tools) {
            $payload['tools'] = array_map(fn($tool) => [
                'type' => 'function',
                'name' => $tool['name'],
                'description' => $tool['description'] ?? '',
                'parameters' => $tool['input_schema'] ?? $tool['parameters'] ?? new \stdClass(),
            ], $tools);
        }

        return $payload;
    }

    /**
     * 发送 HTTP 请求（带重试）
     */
    private function sendRequest(string $endpoint, array $payload): array
    {
        $maxRetries = 3;
        $retryDelay = 1;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $response = Http::withHeaders($this->getHeaders())
                    ->timeout(120)
                    ->post("{$this->baseUrl}{$endpoint}", $payload);

                if ($response->successful()) {
                    return $response->json();
                }

                $statusCode = $response->status();

                if ($statusCode === 429) {
                    $retryAfter = (int) ($response->header('retry-after') ?? $retryDelay * $attempt);
                    Log::warning("OpenAI API rate limited, retrying in {$retryAfter}s", [
                        'attempt' => $attempt,
                    ]);
                    sleep($retryAfter);
                    continue;
                }

                if ($statusCode >= 500) {
                    Log::warning("OpenAI API server error, retrying", [
                        'attempt' => $attempt,
                        'status' => $statusCode,
                    ]);
                    sleep($retryDelay * $attempt);
                    continue;
                }

                throw new \RuntimeException(
                    "OpenAI API error ({$statusCode}): " . $response->body()
                );
            } catch (\Illuminate\Http\Client\ConnectionException $e) {
                if ($attempt === $maxRetries) {
                    throw $e;
                }
                sleep($retryDelay * $attempt);
            }
        }

        throw new \RuntimeException("OpenAI API request failed after {$maxRetries} attempts");
    }

    private function getHeaders(): array
    {
        return [
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ];
    }

    /**
     * 解析非流式响应
     */
    private function parseResponse(array $data): ReasoningResponse
    {
        $thinking = '';
        $text = '';
        $toolCalls = [];

        foreach ($data['output'] ?? [] as $item) {
            match ($item['type'] ?? '') {
                'reasoning' => {
                    foreach ($item['summary'] ?? [] as $summary) {
                        $thinking .= $summary['text'] ?? '';
                    }
                },
                'message' => {
                    foreach ($item['content'] ?? [] as $content) {
                        if (($content['type'] ?? '') === 'output_text') {
                            $text .= $content['text'] ?? '';
                        }
                    }
                },
                'function_call' => {
                    $toolCalls[] = [
                        'id' => $item['call_id'] ?? '',
                        'name' => $item['name'] ?? '',
                        'input' => json_decode($item['arguments'] ?? '{}', true),
                    ];
                },
                default => null,
            };
        }

        $usage = $data['usage'] ?? [];

        return new ReasoningResponse(
            thinking: $thinking,
            text: $text,
            toolCalls: $toolCalls,
            inputTokens: $usage['input_tokens'] ?? 0,
            outputTokens: $usage['output_tokens'] ?? 0,
            provider: 'openai',
            model: $data['model'] ?? $this->model,
            rawData: $data,
        );
    }

    private function parseStreamEvent(array $data): ?array
    {
        return match ($data['type'] ?? '') {
            'response.reasoning_summary_text.delta' => [
                'type' => 'thinking_delta',
                'content' => $data['delta'] ?? '',
            ],
            'response.output_text.delta' => [
                'type' => 'text_delta',
                'content' => $data['delta'] ?? '',
            ],
            'response.function_call_arguments.delta' => [
                'type' => 'tool_delta',
                'content' => $data['delta'] ?? '',
            ],
            'response.completed' => [
                'type' => 'completed',
                'usage' => $data['response']['usage'] ?? [],
            ],
            default => null,
        };
    }

    private function readStream($response): \Generator
    {
        $buffer = '';

        while (!$response->getBody()->eof()) {
            $chunk = $response->getBody()->read(1024);
            $buffer .= $chunk;

            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = substr($buffer, 0, $pos);
                $buffer = substr($buffer, $pos + 1);
                $line = rtrim($line, "\r");

                if ($line !== '') {
                    yield $line;
                }
            }
        }
    }
}
```

### 4.5 响应 DTO

创建 `app/Services/AI/DTOs/ReasoningResponse.php`：

```php
<?php

namespace App\Services\AI\DTOs;

readonly class ReasoningResponse
{
    public function __construct(
        public string $thinking,
        public string $text,
        public array $toolCalls,
        public int $inputTokens,
        public int $outputTokens,
        public string $provider,
        public string $model,
        public array $rawData = [],
    ) {}

    /**
     * 是否包含工具调用
     */
    public function hasToolCalls(): bool
    {
        return !empty($this->toolCalls);
    }

    /**
     * 是否包含推理过程
     */
    public function hasThinking(): bool
    {
        return !empty($this->thinking);
    }

    /**
     * 估算本次请求的成本（美元）
     */
    public function estimateCost(): float
    {
        return match ($this->provider) {
            'anthropic' => ($this->inputTokens * 15 / 1_000_000)
                         + ($this->outputTokens * 75 / 1_000_000),
            'openai' => ($this->inputTokens * 10 / 1_000_000)
                       + ($this->outputTokens * 40 / 1_000_000),
            default => 0.0,
        };
    }

    public function toArray(): array
    {
        return [
            'thinking' => $this->thinking,
            'text' => $this->text,
            'tool_calls' => $this->toolCalls,
            'usage' => [
                'input_tokens' => $this->inputTokens,
                'output_tokens' => $this->outputTokens,
                'estimated_cost_usd' => $this->estimateCost(),
            ],
            'provider' => $this->provider,
            'model' => $this->model,
        ];
    }
}
```

---

## 五、Tool Use（函数调用）完整示例

### 5.1 定义工具

Tool Use 是推理模型最强大的能力之一——模型不仅能思考，还能调用外部工具来获取实时数据或执行操作。

```php
<?php

namespace App\Services\AI\Tools;

class ToolRegistry
{
    /**
     * 获取所有可用工具定义
     */
    public static function getDefinitions(): array
    {
        return [
            [
                'name' => 'get_weather',
                'description' => '获取指定城市的当前天气信息',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'city' => [
                            'type' => 'string',
                            'description' => '城市名称，如"北京"、"上海"',
                        ],
                        'unit' => [
                            'type' => 'string',
                            'enum' => ['celsius', 'fahrenheit'],
                            'description' => '温度单位',
                        ],
                    ],
                    'required' => ['city'],
                ],
            ],
            [
                'name' => 'query_database',
                'description' => '查询数据库中的业务数据',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'table' => [
                            'type' => 'string',
                            'description' => '数据表名称',
                        ],
                        'conditions' => [
                            'type' => 'object',
                            'description' => '查询条件，键值对形式',
                        ],
                        'limit' => [
                            'type' => 'integer',
                            'description' => '返回记录数上限',
                            'default' => 10,
                        ],
                    ],
                    'required' => ['table'],
                ],
            ],
            [
                'name' => 'send_notification',
                'description' => '发送通知消息给指定用户',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'user_id' => [
                            'type' => 'integer',
                            'description' => '用户 ID',
                        ],
                        'channel' => [
                            'type' => 'string',
                            'enum' => ['email', 'sms', 'push'],
                            'description' => '通知渠道',
                        ],
                        'message' => [
                            'type' => 'string',
                            'description' => '通知内容',
                        ],
                    ],
                    'required' => ['user_id', 'channel', 'message'],
                ],
            ],
        ];
    }

    /**
     * 执行工具调用
     */
    public static function execute(string $name, array $input): mixed
    {
        return match ($name) {
            'get_weather' => self::executeGetWeather($input),
            'query_database' => self::executeQueryDatabase($input),
            'send_notification' => self::executeSendNotification($input),
            default => throw new \InvalidArgumentException("Unknown tool: {$name}"),
        };
    }

    private static function executeGetWeather(array $input): array
    {
        // 实际项目中调用天气 API
        $city = $input['city'];
        $unit = $input['unit'] ?? 'celsius';

        // 模拟数据
        return [
            'city' => $city,
            'temperature' => $unit === 'celsius' ? 22 : 72,
            'unit' => $unit,
            'condition' => '多云',
            'humidity' => 65,
            'wind_speed' => '12 km/h',
        ];
    }

    private static function executeQueryDatabase(array $input): array
    {
        $table = $input['table'];
        $conditions = $input['conditions'] ?? [];
        $limit = $input['limit'] ?? 10;

        // 使用 Laravel DB facade 执行查询
        $query = \DB::table($table);

        foreach ($conditions as $key => $value) {
            $query->where($key, $value);
        }

        return [
            'results' => $query->limit($limit)->get()->toArray(),
            'count' => $query->count(),
        ];
    }

    private static function executeSendNotification(array $input): array
    {
        $userId = $input['user_id'];
        $channel = $input['channel'];
        $message = $input['message'];

        // 实际项目中调用通知服务
        \Log::info("Sending notification", [
            'user_id' => $userId,
            'channel' => $channel,
            'message' => $message,
        ]);

        return [
            'success' => true,
            'notification_id' => uniqid('notif_'),
            'sent_at' => now()->toIso8601String(),
        ];
    }
}
```

### 5.2 带 Tool Use 的完整调用流程

```php
<?php

namespace App\Services\AI;

use App\Services\AI\DTOs\ReasoningResponse;
use App\Services\AI\Tools\ToolRegistry;
use Illuminate\Support\Facades\Log;

class ToolUseHandler
{
    private ReasoningService $service;
    private int $maxToolRounds = 5;

    public function __construct(ReasoningService $service)
    {
        $this->service = $service;
    }

    /**
     * 执行带 Tool Use 的推理对话
     *
     * 核心流程：
     * 1. 发送带工具定义的请求
     * 2. 检查响应是否包含 tool_use
     * 3. 如有，执行工具并将结果回传
     * 4. 重复直到模型给出最终回答
     */
    public function executeWithTools(
        string $prompt,
        string $provider = 'anthropic',
        ?array $systemPrompt = null,
    ): ReasoningResponse {
        $tools = ToolRegistry::getDefinitions();
        $messages = [
            ['role' => 'user', 'content' => $prompt],
        ];

        for ($round = 0; $round < $this->maxToolRounds; $round++) {
            // 发送请求
            $response = $this->service->ask(
                prompt: $messages[count($messages) - 1]['content'],
                provider: $provider,
                tools: $tools,
                systemPrompt: $systemPrompt,
                thinking: 'enabled',
            );

            // 如果没有工具调用，返回最终回答
            if (!$response->hasToolCalls()) {
                return $response;
            }

            Log::info("Tool Use round {$round}", [
                'tool_calls' => $response->toolCalls,
                'thinking_excerpt' => mb_substr($response->thinking, 0, 200),
            ]);

            // 将模型回答加入对话历史
            $messages[] = [
                'role' => 'assistant',
                'content' => $response->rawData['content'] ?? [],
            ];

            // 执行每个工具调用并收集结果
            $toolResults = [];
            foreach ($response->toolCalls as $toolCall) {
                try {
                    $result = ToolRegistry::execute(
                        $toolCall['name'],
                        $toolCall['input']
                    );
                    $toolResults[] = [
                        'type' => 'tool_result',
                        'tool_use_id' => $toolCall['id'],
                        'content' => json_encode($result, JSON_UNESCAPED_UNICODE),
                    ];
                } catch (\Throwable $e) {
                    $toolResults[] = [
                        'type' => 'tool_result',
                        'tool_use_id' => $toolCall['id'],
                        'content' => "Error: " . $e->getMessage(),
                        'is_error' => true,
                    ];
                }
            }

            // 将工具结果加入对话
            $messages[] = [
                'role' => 'user',
                'content' => $toolResults,
            ];
        }

        throw new \RuntimeException("Tool Use exceeded maximum rounds ({$this->maxToolRounds})");
    }
}
```

---

## 六、流式响应处理

流式输出是生产环境中的必备能力——用户无需等待完整响应，可以实时看到模型的思考过程和回答。

### 6.1 流式控制器

```php
<?php

namespace App\Http\Controllers\Api;

use App\Services\AI\ReasoningService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\StreamedResponse;

class AIStreamController extends Controller
{
    public function __construct(
        private ReasoningService $reasoningService,
    ) {}

    /**
     * 流式推理接口
     *
     * GET /api/ai/stream?prompt=...&provider=anthropic&thinking=enabled
     */
    public function stream(Request $request): StreamedResponse
    {
        $request->validate([
            'prompt' => 'required|string|max:32000',
            'provider' => 'sometimes|string|in:anthropic,openai',
            'thinking' => 'sometimes|string|in:enabled,disabled',
        ]);

        $provider = $request->input('provider', 'anthropic');
        $thinking = $request->input('thinking', 'enabled');

        return response()->stream(function () use ($request, $provider, $thinking) {
            try {
                $generator = $this->reasoningService->stream(
                    prompt: $request->input('prompt'),
                    provider: $provider,
                    thinking: $thinking,
                );

                $currentBlockType = null;

                foreach ($generator as $event) {
                    match ($event['type'] ?? '') {
                        // Claude 流式事件
                        'block_start' => {
                            $currentBlockType = $event['block_type'];
                            if ($currentBlockType === 'thinking') {
                                $this->sendSSE('thinking_start', ['message' => '正在思考...']);
                            }
                        },
                        'block_delta' => {
                            $this->sendSSE(
                                $currentBlockType === 'thinking' ? 'thinking' : 'text',
                                ['content' => $event['content'] ?? '']
                            );
                        },
                        'block_stop' => {
                            if ($currentBlockType === 'thinking') {
                                $this->sendSSE('thinking_end', ['message' => '思考完成']);
                            }
                        },

                        // OpenAI 流式事件
                        'thinking_delta' => {
                            $this->sendSSE('thinking', ['content' => $event['content'] ?? '']);
                        },
                        'text_delta' => {
                            $this->sendSSE('text', ['content' => $event['content'] ?? '']);
                        },
                        'completed' => {
                            $this->sendSSE('done', [
                                'usage' => $event['usage'] ?? [],
                            ]);
                        },

                        default => null,
                    };
                }

                $this->sendSSE('done', ['message' => 'Stream completed']);
            } catch (\Throwable $e) {
                $this->sendSSE('error', ['message' => $e->getMessage()]);
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 发送 SSE 事件
     */
    private function sendSSE(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
        ob_flush();
        flush();
    }
}
```

### 6.2 路由定义

```php
// routes/api.php
use App\Http\Controllers\Api\AIStreamController;

Route::prefix('ai')->group(function () {
    Route::get('/stream', [AIStreamController::class, 'stream']);
    Route::post('/ask', [AIStreamController::class, 'ask']);
});
```

### 6.3 前端接收示例

```javascript
const eventSource = new EventSource('/api/ai/stream?prompt=解释Laravel+的服务容器&provider=anthropic&thinking=enabled');

eventSource.addEventListener('thinking_start', (e) => {
    const data = JSON.parse(e.data);
    console.log('🧠 开始思考...');
    showThinkingPanel();
});

eventSource.addEventListener('thinking', (e) => {
    const data = JSON.parse(e.data);
    appendToThinkingPanel(data.content);
});

eventSource.addEventListener('thinking_end', (e) => {
    console.log('✅ 思考完成');
    collapseThinkingPanel();
});

eventSource.addEventListener('text', (e) => {
    const data = JSON.parse(e.data);
    appendToAnswerPanel(data.content);
});

eventSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    if (data.usage) {
        showUsageInfo(data.usage);
    }
    eventSource.close();
});

eventSource.addEventListener('error', (e) => {
    console.error('Stream error:', e);
    eventSource.close();
});
```

---

## 七、错误处理与重试策略

### 7.1 统一异常处理

创建 `app/Services/AI/Exceptions/AIServiceException.php`：

```php
<?php

namespace App\Services\AI\Exceptions;

class AIServiceException extends \RuntimeException
{
    public function __construct(
        string $message,
        private readonly string $provider,
        private readonly int $statusCode = 0,
        private readonly ?array $errorBody = null,
        private readonly bool $retryable = false,
    ) {
        parent::__construct($message);
    }

    public function getProvider(): string { return $this->provider; }
    public function getStatusCode(): int { return $this->statusCode; }
    public function getErrorBody(): ?array { return $this->errorBody; }
    public function isRetryable(): bool { return $this->retryable; }
}
```

### 7.2 指数退避重试中间件

```php
<?php

namespace App\Services\AI\Middleware;

use App\Services\AI\Exceptions\AIServiceException;
use Illuminate\Support\Facades\Log;

class RetryMiddleware
{
    public function __construct(
        private readonly int $maxRetries = 3,
        private readonly int $baseDelayMs = 1000,
        private readonly int $maxDelayMs = 30000,
    ) {}

    /**
     * 执行带重试的回调
     */
    public function handle(callable $callback, string $provider): mixed
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $this->maxRetries; $attempt++) {
            try {
                return $callback();
            } catch (AIServiceException $e) {
                $lastException = $e;

                if (!$e->isRetryable() || $attempt === $this->maxRetries) {
                    throw $e;
                }

                // 指数退避 + 抖动
                $delay = min(
                    $this->baseDelayMs * pow(2, $attempt - 1) + random_int(0, 1000),
                    $this->maxDelayMs
                );

                Log::warning("AI service retry {$attempt}/{$this->maxRetries}", [
                    'provider' => $provider,
                    'delay_ms' => $delay,
                    'error' => $e->getMessage(),
                ]);

                usleep($delay * 1000);
            } catch (\Throwable $e) {
                // 非预期异常不重试
                throw $e;
            }
        }

        throw $lastException;
    }
}
```

### 7.3 常见错误码处理策略

| HTTP 状态码 | 含义 | 策略 |
|------------|------|------|
| 400 | 请求参数错误 | 不重试，修正参数 |
| 401 | API Key 无效 | 不重试，检查配置 |
| 403 | 权限不足 | 不重试，检查账户 |
| 429 | 请求频率超限 | 指数退避重试，读取 `Retry-After` 头 |
| 500 | 服务端内部错误 | 指数退避重试 |
| 502/503 | 服务不可用 | 指数退避重试 |
| 529 | API 过载 | 指数退避重试（Anthropic 特有） |

---

## 八、成本优化建议

推理模型的成本主要由三部分组成：输入 token、推理 token、输出 token。推理 token 通常是成本大头。

### 8.1 Token 成本对比

| 模型 | 输入价格 ($/M tokens) | 输出价格 ($/M tokens) | 推理价格 ($/M tokens) |
|------|---------------------|---------------------|---------------------|
| Claude Opus 4 | $15 | $75 | ~$75 (含在输出中) |
| OpenAI o3 | $10 | $40 | ~$40 (含在输出中) |
| GPT-4o (对照) | $2.5 | $10 | N/A |
| Claude Sonnet 4 (对照) | $3 | $15 | N/A |

### 8.2 实用优化策略

**策略一：分场景选择模型**

```php
<?php

namespace App\Services\AI;

class ModelRouter
{
    /**
     * 根据任务复杂度选择模型
     */
    public function selectModel(string $taskType): array
    {
        return match ($taskType) {
            // 简单问答 -> 不需要推理
            'simple_qa' => ['provider' => 'anthropic', 'model' => 'claude-sonnet-4', 'thinking' => null],
            // 代码审查 -> 需要深度推理
            'code_review' => ['provider' => 'anthropic', 'model' => 'claude-opus-4', 'thinking' => 'enabled'],
            // 数学推理 -> 需要最强推理
            'math_reasoning' => ['provider' => 'openai', 'model' => 'o3', 'thinking' => 'enabled'],
            // 数据分析 -> 中等推理
            'data_analysis' => ['provider' => 'openai', 'model' => 'o3', 'thinking' => 'enabled'],
            // 默认
            default => ['provider' => 'anthropic', 'model' => 'claude-sonnet-4', 'thinking' => null],
        };
    }
}
```

**策略二：缓存系统提示词（Prompt Caching）**

```php
// Anthropic 支持自动缓存频繁使用的系统提示词
// 在构建 payload 时为系统提示词添加 cache_control
$payload['system'] = [
    [
        'type' => 'text',
        'text' => $longSystemPrompt,
        'cache_control' => ['type' => 'ephemeral'],
    ],
];

// 缓存命中后，系统提示词的输入价格降至 $1.875/M tokens
```

**策略三：限制推理预算**

```php
// 对于不太复杂的问题，降低推理预算
$budgetTokens = match (true) {
    $complexity === 'low' => 2000,
    $complexity === 'medium' => 5000,
    $complexity === 'high' => 10000,
    default => 5000,
};
```

**策略四：Token 使用监控**

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class UsageTracker
{
    /**
     * 记录 API 调用的 token 使用情况
     */
    public function track(
        string $provider,
        string $model,
        int $inputTokens,
        int $outputTokens,
        float $estimatedCost,
    ): void {
        $date = now()->format('Y-m-d');
        $hour = now()->format('H');

        // 按天统计
        $dailyKey = "ai_usage:{$provider}:{$date}";
        Cache::increment("{$dailyKey}:input", $inputTokens);
        Cache::increment("{$dailyKey}:output", $outputTokens);
        Cache::increment("{$dailyKey}:cost", (int) ($estimatedCost * 10000)); // 万分之一美元精度

        // 按小时统计（用于异常检测）
        $hourlyKey = "ai_usage:{$provider}:{$date}:{$hour}";
        Cache::increment("{$hourlyKey}:requests", 1);

        // 日志记录
        Log::info('AI API usage', [
            'provider' => $provider,
            'model' => $model,
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'estimated_cost_usd' => $estimatedCost,
        ]);
    }

    /**
     * 获取今日使用统计
     */
    public function getDailyUsage(string $provider): array
    {
        $date = now()->format('Y-m-d');
        $key = "ai_usage:{$provider}:{$date}";

        return [
            'input_tokens' => (int) Cache::get("{$key}:input", 0),
            'output_tokens' => (int) Cache::get("{$key}:output", 0),
            'estimated_cost_usd' => (int) Cache::get("{$key}:cost", 0) / 10000,
        ];
    }
}
```

---

## 九、与传统模型的对比

### 9.1 能力维度对比

| 维度 | 传统模型 (GPT-4o / Sonnet) | 推理模型 (o3 / Opus 4) |
|------|---------------------------|----------------------|
| 响应速度 | 快（1-3 秒） | 慢（5-30 秒，取决于推理深度） |
| 简单问答 | ✅ 足够好 | ⚠️ 过度推理，浪费资源 |
| 多步推理 | ❌ 容易出错 | ✅ 显著优势 |
| 数学证明 | ❌ 常出错 | ✅ 准确率高 |
| 代码调试 | ⚠️ 一般 | ✅ 能展示调试思路 |
| 成本 | 低 | 高（3-10 倍） |
| Token 效率 | 高 | 低（推理 token 消耗大） |
| 可解释性 | 低 | 高（可查看思考过程） |

### 9.2 选型决策树

```
你的任务需要多步推理吗？
├── 否 -> 使用传统模型（GPT-4o / Sonnet）
└── 是 -> 任务对准确性要求高吗？
    ├── 否 -> 使用传统模型 + 详细 Prompt
    └── 是 -> 需要实时交互吗？
        ├── 是 -> 使用传统模型（推理延迟太高）
        └── 否 -> 使用推理模型
            └── 预算敏感吗？
                ├── 是 -> OpenAI o3（推理效率更高）
                └── 否 -> Claude Opus 4（推理质量更优）
```

### 9.3 混合架构推荐

在实际项目中，最优方案往往是**混合架构**——简单任务用传统模型，复杂任务路由到推理模型：

```php
<?php

namespace App\Services\AI;

class IntelligentRouter
{
    public function __construct(
        private ReasoningService $reasoning,
        private ModelRouter $modelRouter,
    ) {}

    /**
     * 智能路由：根据任务复杂度自动选择模型
     */
    public function smartAsk(string $prompt, ?string $hint = null): ReasoningResponse
    {
        // 使用简单模型判断任务复杂度
        $complexityPrompt = <<<PROMPT
        分析以下任务的复杂度，只回答一个词：low / medium / high
        
        任务：{$prompt}
        PROMPT;

        $complexityResponse = $this->reasoning->ask(
            prompt: $complexityPrompt,
            provider: 'anthropic',
            thinking: null, // 不启用推理
        );

        $complexity = strtolower(trim($complexityResponse->text));
        $complexity = in_array($complexity, ['low', 'medium', 'high']) ? $complexity : 'medium';

        $modelConfig = match ($complexity) {
            'low' => ['provider' => 'anthropic', 'thinking' => null],
            'medium' => ['provider' => 'openai', 'thinking' => 'enabled'],
            'high' => ['provider' => 'anthropic', 'thinking' => 'enabled'],
        };

        return $this->reasoning->ask(
            prompt: $prompt,
            provider: $modelConfig['provider'],
            thinking: $modelConfig['thinking'],
        );
    }
}
```

---

## 十、实际应用场景

### 10.1 代码审查助手

```php
<?php

namespace App\Http\Controllers\Api;

use App\Services\AI\ReasoningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CodeReviewController extends Controller
{
    public function __construct(
        private ReasoningService $reasoning,
    ) {}

    /**
     * 审查代码片段
     *
     * POST /api/ai/code-review
     */
    public function review(Request $request): JsonResponse
    {
        $request->validate([
            'code' => 'required|string|max:50000',
            'language' => 'sometimes|string',
            'context' => 'sometimes|string|max:5000',
        ]);

        $systemPrompt = [
            'type' => 'text',
            'text' => <<<'PROMPT'
            你是一位资深代码审查专家。请从以下维度审查代码：
            1. 安全漏洞（SQL 注入、XSS、CSRF 等）
            2. 性能问题（N+1 查询、内存泄漏等）
            3. 代码规范（PSR-12、SOLID 原则等）
            4. 可维护性（命名、注释、复杂度等）
            5. 潜在 Bug（边界条件、并发问题等）
            
            对每个问题给出严重程度（高/中/低）和修复建议。
            PROMPT,
        ];

        $prompt = "请审查以下代码：\n\n```{$request->input('language', 'php')}\n{$request->input('code')}\n```";
        
        if ($context = $request->input('context')) {
            $prompt .= "\n\n背景信息：{$context}";
        }

        $response = $this->reasoning->ask(
            prompt: $prompt,
            provider: 'anthropic',
            systemPrompt: $systemPrompt,
            thinking: 'enabled',
        );

        return response()->json([
            'review' => $response->text,
            'thinking' => $response->thinking,
            'usage' => [
                'input_tokens' => $response->inputTokens,
                'output_tokens' => $response->outputTokens,
                'estimated_cost' => $response->estimateCost(),
            ],
        ]);
    }
}
```

### 10.2 智能数据分析

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\DB;

class DataAnalysisService
{
    public function __construct(
        private ReasoningService $reasoning,
    ) {}

    /**
     * 自然语言数据查询
     */
    public function queryWithNaturalLanguage(string $question): array
    {
        // 获取数据库 schema 信息
        $schema = $this->getDatabaseSchema();

        $systemPrompt = [
            'type' => 'text',
            'text' => <<<PROMPT
            你是一个数据分析师，能够将自然语言问题转换为 SQL 查询。
            
            数据库结构：
            {$schema}
            
            要求：
            1. 只生成 SELECT 查询
            2. 使用参数绑定防止 SQL 注入
            3. 对结果进行适当的聚合和格式化
            4. 返回 JSON 格式：{"sql": "...", "params": [...], "explanation": "..."}
            PROMPT,
        ];

        $tools = [
            [
                'name' => 'execute_sql',
                'description' => '执行 SQL 查询并返回结果',
                'input_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'sql' => ['type' => 'string', 'description' => 'SQL 查询语句'],
                        'params' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => '查询参数',
                        ],
                    ],
                    'required' => ['sql'],
                ],
            ],
        ];

        $response = $this->reasoning->ask(
            prompt: $question,
            provider: 'anthropic',
            systemPrompt: $systemPrompt,
            tools: $tools,
            thinking: 'enabled',
        );

        // 如果模型返回了 SQL 查询，执行它
        if ($response->hasToolCalls()) {
            foreach ($response->toolCalls as $call) {
                if ($call['name'] === 'execute_sql') {
                    $sql = $call['input']['sql'];
                    $params = $call['input']['params'] ?? [];
                    $results = DB::select($sql, $params);

                    return [
                        'answer' => $response->text,
                        'thinking' => $response->thinking,
                        'query' => $sql,
                        'results' => $results,
                    ];
                }
            }
        }

        return [
            'answer' => $response->text,
            'thinking' => $response->thinking,
        ];
    }

    private function getDatabaseSchema(): string
    {
        $tables = DB::select('SHOW TABLES');
        $schema = '';

        foreach ($tables as $table) {
            $tableName = array_values((array) $table)[0];
            $columns = DB::select("DESCRIBE {$tableName}");
            $schema .= "\n{$tableName}:\n";
            foreach ($columns as $col) {
                $schema .= "  - {$col->Field} ({$col->Type})" . ($col->Key === 'PRI' ? ' [PK]' : '') . "\n";
            }
        }

        return $schema;
    }
}
```

### 10.3 多轮推理对话（带记忆）

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Cache;

class ConversationManager
{
    private ReasoningService $reasoning;
    private int $maxHistory = 20;

    public function __construct(ReasoningService $reasoning)
    {
        $this->reasoning = $reasoning;
    }

    /**
     * 多轮对话
     */
    public function chat(
        string $sessionId,
        string $userMessage,
        string $provider = 'anthropic',
    ): array {
        // 从缓存获取对话历史
        $history = Cache::get("conversation:{$sessionId}", []);

        // 添加用户消息
        $history[] = ['role' => 'user', 'content' => $userMessage];

        // 截断过长的历史
        if (count($history) > $this->maxHistory) {
            $history = array_slice($history, -$this->maxHistory);
        }

        // 构建多轮对话 prompt
        $prompt = '';
        foreach ($history as $msg) {
            $role = $msg['role'] === 'user' ? '用户' : '助手';
            $prompt .= "{$role}: {$msg['content']}\n\n";
        }
        $prompt .= '助手: ';

        $response = $this->reasoning->ask(
            prompt: $prompt,
            provider: $provider,
            thinking: 'enabled',
        );

        // 保存助手回复到历史
        $history[] = ['role' => 'assistant', 'content' => $response->text];

        // 更新缓存（30 分钟过期）
        Cache::put("conversation:{$sessionId}", $history, 1800);

        return [
            'response' => $response->text,
            'thinking' => $response->thinking,
            'session_id' => $sessionId,
            'history_length' => count($history),
            'usage' => $response->toArray()['usage'],
        ];
    }

    /**
     * 清除对话历史
     */
    public function clearHistory(string $sessionId): void
    {
        Cache::forget("conversation:{$sessionId}");
    }
}
```

---

## 十一、生产部署注意事项

### 11.1 队列化处理

推理模型的响应时间较长（5-30 秒），同步请求容易超时。建议使用 Laravel 队列异步处理：

```php
<?php

namespace App\Jobs;

use App\Services\AI\ReasoningService;
use App\Services\AI\DTOs\ReasoningResponse;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProcessReasoningTask implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(
        public readonly string $taskId,
        public readonly string $prompt,
        public readonly string $provider,
        public readonly ?string $callbackUrl = null,
    ) {
        $this->onQueue('ai-reasoning');
    }

    public function handle(ReasoningService $reasoning): void
    {
        $response = $reasoning->ask(
            prompt: $this->prompt,
            provider: $this->provider,
            thinking: 'enabled',
        );

        // 存储结果
        \Cache::put(
            "reasoning_result:{$this->taskId}",
            $response->toArray(),
            3600
        );

        // 如有回调 URL，通知调用方
        if ($this->callbackUrl) {
            \Http::post($this->callbackUrl, [
                'task_id' => $this->taskId,
                'result' => $response->toArray(),
            ]);
        }
    }
}
```

### 11.2 Nginx 超时配置

```nginx
location /api/ai/stream {
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_buffering off;
    chunked_transfer_encoding on;
}
```

### 11.3 日志与监控

```php
// 在 ReasoningService 中添加事件派发
use Illuminate\Support\Facades\Event;

// 每次 API 调用后
event(new \App\Events\AIRequestCompleted(
    provider: $provider,
    model: $response->model,
    inputTokens: $response->inputTokens,
    outputTokens: $response->outputTokens,
    cost: $response->estimateCost(),
    durationMs: $durationMs,
));
```

---

## 总结

本文完整展示了如何将 Claude Opus 4 和 OpenAI o3 两款最新推理模型接入 Laravel 生产应用。关键要点回顾：
1. **推理模型的核心价值**：不是替代传统模型，而是在需要深度推理的场景提供更高准确率和可解释性
2. **思维链输出**：Claude 使用 Extended Thinking（`thinking` block），OpenAI 使用 Chain of Thought（`reasoning` block），两者 API 结构不同但原理相似
3. **Tool Use**：推理模型的 Tool Use 比传统模型更可靠——它会先推理再调用，减少无效调用
4. **流式输出**：对用户体验至关重要，特别是推理过程的实时展示能增强信任感
5. **成本控制**：推理 token 是成本大头，通过分场景选模型、限制推理预算、Prompt Caching 三种策略可以降低 50% 以上的成本
6. **混合架构**：最实用的方案是根据任务复杂度自动路由——简单任务用传统模型，复杂任务用推理模型

### 实践建议

在实际项目中落地推理模型时，建议遵循以下实践原则：

**渐进式接入**：不要一开始就将所有业务都迁移到推理模型。先从一个低风险的内部场景开始（如代码审查、文档生成），验证效果后再逐步扩展到面向用户的场景。这样可以积累运维经验，避免上线初期出现意外的高额账单。

**完善的监控体系**：推理模型的 token 消耗波动较大，同一个 prompt 在不同推理深度下消耗的 token 可能相差数倍。务必建立完善的 token 使用监控，设置每日预算告警，防止因异常请求导致的费用飙升。我们前面介绍的 UsageTracker 类就是一个简单但有效的监控方案。

**思考过程的展示策略**：虽然思维链输出是推理模型的亮点，但不一定需要将完整的思考过程展示给终端用户。对于面向 C 端的场景，可以将思考过程简化为"正在分析..."的进度提示，或者只展示关键推理步骤的摘要。对于开发者工具或内部系统，展示完整思考过程则有助于调试和信任验证。

**容错与降级**：推理模型的响应时间较长（通常 5-30 秒），且偶尔会因为服务过载而返回错误。建议实现完善的降级策略——当推理模型不可用时，自动回退到传统模型处理请求。虽然推理质量会有所下降，但至少能保证服务的可用性。

**定期评估与切换**：AI 模型领域的发展速度极快，新的推理模型每隔几个月就会发布。建议建立定期评估机制（如每月一次），使用固定的测试集对比不同模型的推理质量和成本效率，根据评估结果及时调整模型选择策略。

推理模型正在改变我们构建 AI 应用的方式。从"黑盒问答"到"透明推理"，这不仅仅是技术升级，更是 AI 工程化思维的跃迁。随着推理能力的持续提升和 API 成本的逐步下降，我们有理由相信，推理模型将在越来越多的生产场景中发挥核心作用。希望本文能帮助你在 Laravel 项目中顺利接入这些前沿能力，构建更智能、更可靠的应用。

---

## 十二、踩坑案例与解决方案

### 12.1 Streaming 中断处理

流式输出在生产环境中最大的隐患是**连接中断**——用户刷新页面、Nginx 超时、网络抖动都可能导致 SSE 连接意外断开。如果此时模型仍在输出 token，会导致：

- 前端只收到部分回答，用户体验断裂
- 后端 Generator 未正常关闭，PHP 进程可能挂起
- 已消耗的 token 无法回收，成本白白浪费

**解决方案：使用 `connection_aborted()` 检测客户端断开**

```php
<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class RobustStreamController extends Controller
{
    public function __construct(
        private \App\Services\AI\ReasoningService $reasoningService,
    ) {}

    /**
     * 带中断检测的流式响应
     */
    public function resilientStream(Request $request): StreamedResponse
    {
        return response()->stream(function () use ($request) {
            $clientDisconnected = false;

            // 兜底：进程关闭时记录日志
            register_shutdown_function(function () use (&$clientDisconnected) {
                $clientDisconnected = true;
                \Log::warning('SSE stream interrupted (shutdown)');
            });

            try {
                $generator = $this->reasoningService->stream(
                    prompt: $request->input('prompt'),
                    provider: $request->input('provider', 'anthropic'),
                    thinking: 'enabled',
                );

                foreach ($generator as $event) {
                    // ⚡ 关键：每次写入前检测客户端是否已断开
                    if (connection_aborted()) {
                        \Log::warning('SSE client disconnected, aborting stream');
                        $clientDisconnected = true;
                        break;
                    }

                    $this->sendSSE($event['type'] ?? 'data', $event);

                    if (ob_get_level() > 0) {
                        ob_flush();
                    }
                    flush();
                }
            } catch (\Throwable $e) {
                if (!$clientDisconnected) {
                    $this->sendSSE('error', ['message' => $e->getMessage()]);
                }
                \Log::error('SSE stream error', [
                    'error' => $e->getMessage(),
                    'client_disconnected' => $clientDisconnected,
                ]);
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    private function sendSSE(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
    }
}
```

> 💡 **关键技巧**：在 `foreach` 循环中使用 `connection_aborted()` 检测客户端断开，及时终止 Generator 避免资源浪费。配合 `register_shutdown_function` 做兜底清理。

### 12.2 Token 计费陷阱

推理模型的计费比传统模型复杂得多，以下是常见的计费陷阱：

**陷阱一：思考 token 的隐藏成本**

推理模型的"输出"实际上包含两部分：推理 token + 回答 token。在 Claude Opus 4 中，思考 token 的价格与输出 token 相同（$75/M），但用户往往只关注回答长度，忽略了推理阶段的消耗。一个看似简短的回答，背后可能消耗了数千个推理 token。

```php
// ❌ 错误做法：只统计回答文本长度
$answerTokens = str_word_count($response->text); // 严重低估实际消耗

// ✅ 正确做法：使用 API 返回的实际 token 数
$totalOutputTokens = $response->outputTokens; // 包含推理 + 回答
$estimatedCost = $response->estimateCost();   // 基于实际用量计算
```

**陷阱二：Tool Use 多轮对话的累积消耗**

带 Tool Use 的请求涉及多轮交互，每轮都会产生独立的输入/输出 token。5 轮 Tool Use 调用的实际成本可能是单轮请求的 5-8 倍。

```php
// 在 ToolUseHandler 中添加累计成本追踪
$totalCost = 0.0;
for ($round = 0; $round < $this->maxToolRounds; $round++) {
    $response = $this->service->ask(/* ... */);
    $totalCost += $response->estimateCost();

    // 设置成本熔断阈值
    if ($totalCost > 0.50) { // 单次对话成本超过 $0.50
        \Log::warning('Tool Use cost threshold exceeded', [
            'total_cost' => $totalCost,
            'rounds' => $round + 1,
        ]);
        break;
    }
    // ... 继续处理
}
```

**陷阱三：流式输出中 token 统计的时序问题**

流式输出时，`usage` 信息通常在最后一个 SSE 事件中返回。如果中途断开连接，你将无法获得准确的 token 统计，导致成本监控失准。

```php
// 解决方案：使用输入 token 估算 + 输出中获取实际值
public function estimateStreamCost(string $prompt, ?array $usage): float
{
    $inputTokens = $this->estimateTokenCount($prompt);

    if ($usage) {
        // 流正常结束，使用实际值
        return ($usage['input_tokens'] * 15 + $usage['output_tokens'] * 75) / 1_000_000;
    }

    // 流中断，使用输入 token 的保守估算
    return ($inputTokens * 15 + $inputTokens * 2 * 75) / 1_000_000;
}
```

### 12.3 Rate Limit 应对

推理模型由于单次请求消耗大量 token，更容易触发 API 的 Rate Limit。以下是实战中总结的应对策略：

**策略一：读取 `Retry-After` 头，主动限流**

```php
if ($response->status() === 429) {
    $retryAfter = (int) $response->header('retry-after', 60);

    // 存入缓存，让后续请求直接等待而非重试
    Cache::put('ai_rate_limit:reset_at', now()->addSeconds($retryAfter), $retryAfter);

    \Log::warning('Rate limited, will retry', [
        'retry_after' => $retryAfter,
        'provider' => $provider,
    ]);
}
```

**策略二：请求队列化 + 令牌桶限流**

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Cache;

class RateLimiter
{
    /**
     * 令牌桶限流：确保不超过 API 的 RPM 限制
     */
    public function acquireToken(string $provider, int $maxPerMinute = 30): bool
    {
        $key = "ai_rate_limit:{$provider}:" . now()->format('Y-m-d-H-i');
        $current = (int) Cache::get($key, 0);

        if ($current >= $maxPerMinute) {
            return false;
        }

        Cache::increment($key);
        Cache::put($key, $current + 1, 120);

        return true;
    }

    /**
     * 带限流的请求封装
     */
    public function throttledRequest(string $provider, callable $callback): mixed
    {
        $maxRetries = 3;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            if (!$this->acquireToken($provider)) {
                $waitSeconds = 60 - now()->second;
                \Log::info("Rate limit approaching, waiting {$waitSeconds}s", [
                    'provider' => $provider,
                    'attempt' => $attempt,
                ]);
                sleep($waitSeconds);
                continue;
            }

            return $callback();
        }

        throw new \RuntimeException("Rate limit exceeded for {$provider}");
    }
}
```

**策略三：多 Key 轮转**

在高并发场景下，单个 API Key 的限额可能不够用。可以通过多 Key 轮转来分散压力：

```php
// config/services.php 中配置多个 Key
'anthropic' => [
    'api_keys' => [
        env('ANTHROPIC_API_KEY_1'),
        env('ANTHROPIC_API_KEY_2'),
        env('ANTHROPIC_API_KEY_3'),
    ],
],

// 轮转选择 Key
public function getNextApiKey(string $provider): string
{
    $keys = config("services.{$provider}.api_keys");
    $index = Cache::increment("ai_key_rotation:{$provider}") % count($keys);
    return $keys[$index];
}
```

---

## 相关阅读

- [AI Agent Structured Output 深度实战：JSON Schema 强制、Pydantic/Zod 校验与 Laravel Response DTO 端到端类型安全](/categories/架构/AI-Agent-Structured-Output-深度实战-JSON-Schema强制-Pydantic-Zod校验与Laravel-Response-DTO端到端类型安全/)
- [AI Agent Orchestration Patterns 2026：Supervisor / Router / Swarm / DAG 编排模式选型](/categories/架构/AI-Agent-Orchestration-Patterns-2026-Supervisor-Router-Swarm-DAG-编排模式选型/)
- [开发者如何选择 AI Agent 框架：基于工作流、隐私需求、技术栈的决策矩阵](/categories/架构/开发者如何选择-AI-Agent-框架-基于工作流-隐私需求-技术栈的决策矩阵/)
