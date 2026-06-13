---
title: "Laravel + AWS Bedrock 实战：Amazon 托管 LLM 服务——Claude/Llama/Titan 模型的统一接入与成本优化"
keywords: [Laravel, AWS Bedrock, Amazon, LLM, Claude, Llama, Titan, 托管, 服务, 模型的统一接入与成本优化]
date: 2026-06-09 06:51:00
categories:
  - ai
tags:
  - Laravel
  - AWS Bedrock
  - Claude
  - LLaMA
  - Titan
  - LLM
  - PHP
description: "在 Laravel 项目中统一接入 AWS Bedrock 托管的多种 LLM（Claude、Llama、Titan），实现模型切换、流式输出、Token 计费追踪与成本优化的完整实战方案。"
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
---


## 前言

2024 年以来，大语言模型（LLM）的应用已经从「尝鲜」阶段进入「落地」阶段。但一个现实问题是：不同模型各有擅长——Claude 在长文本和推理上表现优异，Llama 开源可控成本低，Titan 在 AWS 生态内延迟最低。如果你的业务需要根据场景动态切换模型，或者需要在成本和效果之间找到平衡点，AWS Bedrock 是目前最省心的方案之一。

本文记录在 Laravel 8 项目中接入 AWS Bedrock 的完整过程：从 SDK 配置、多模型统一封装、流式输出、Token 追踪到成本优化策略。所有代码均来自生产环境实践。

## AWS Bedrock 是什么

AWS Bedrock 是 Amazon 的全托管 LLM 服务，核心卖点：

- **多模型统一 API**：通过同一套 `InvokeModel` / `InvokeModelWithResponseStream` 接口调用 Claude（Anthropic）、Llama（Meta）、Titan（Amazon）、Jurassic（AI21）等模型
- **按量计费**：按输入/输出 Token 数计费，无需预置 GPU 实例
- **安全合规**：数据不出 AWS VPC，支持 PrivateLink，满足企业合规要求
- **Provisioned Throughput**：对高并发场景可购买预留吞吐，降低单次调用成本

### 模型定价对比（2026 年参考）

| 模型 | 输入价格 ($/1M tokens) | 输出价格 ($/1M tokens) | 适用场景 |
|------|----------------------|----------------------|---------|
| Claude 3.5 Sonnet | $3.00 | $15.00 | 复杂推理、长文本 |
| Claude 3 Haiku | $0.25 | $1.25 | 低延迟、高频简单任务 |
| Llama 3 70B | $0.65 | $0.65 | 开源模型、成本敏感 |
| Llama 3 8B | $0.20 | $0.20 | 轻量任务、嵌入式 |
| Titan Text G1 | $0.50 | $0.85 | AWS 原生、低延迟 |

> 价格随 AWS 调整，以 Bedrock 控制台实际显示为准。

## 环境准备

### 1. AWS 配置

先确保 IAM 用户/角色有 Bedrock 权限：

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:GetFoundationModel",
                "bedrock:ListFoundationModels"
            ],
            "Resource": "arn:aws:bedrock:*::foundation-model/*"
        }
    ]
}
```

然后在 Bedrock 控制台的 **Model access** 页面，申请你需要的模型访问权限。Claude 和 Llama 需要单独申请，Titan 默认可用。

### 2. Laravel 项目依赖

```bash
composer require aws/aws-sdk-php
```

`.env` 配置：

```env
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_DEFAULT_REGION=us-east-1
AWS_BEDROCK_MODEL_DEFAULT=anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_BEDROCK_MAX_TOKENS=4096
AWS_BEDROCK_TEMPERATURE=0.7
```

> **Region 注意**：Bedrock 的模型可用区不同。Claude 在 `us-east-1` 和 `us-west-2` 可用，Llama 在 `us-east-1` 和 `eu-west-1` 可用。建议选 `us-east-1` 覆盖最全。

## 核心封装：统一 LLM 服务

### 服务层设计

创建 `app/Services/LLM/BedrockService.php`：

```php
<?php

namespace App\Services\LLM;

use Aws\BedrockRuntime\BedrockRuntimeClient;
use Aws\BedrockRuntime\Exception\BedrockRuntimeException;
use Illuminate\Support\Facades\Log;

class BedrockService
{
    private BedrockRuntimeClient $client;
    private string $defaultModel;
    private int $maxTokens;
    private float $temperature;

    // 模型 ID 映射
    public const MODELS = [
        'claude-sonnet'  => 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        'claude-haiku'   => 'anthropic.claude-3-haiku-20240307-v1:0',
        'claude-opus'    => 'anthropic.claude-3-opus-20240229-v1:0',
        'llama3-70b'     => 'meta.llama3-70b-instruct-v1:0',
        'llama3-8b'      => 'meta.llama3-8b-instruct-v1:0',
        'titan-text'     => 'amazon.titan-text-premier-v1:0',
        'titan-express'  => 'amazon.titan-text-express-v1',
    ];

    public function __construct()
    {
        $this->client = new BedrockRuntimeClient([
            'region'  => config('services.bedrock.region', 'us-east-1'),
            'version' => 'latest',
        ]);

        $this->defaultModel = config(
            'services.bedrock.default_model',
            self::MODELS['claude-sonnet']
        );
        $this->maxTokens    = (int) config('services.bedrock.max_tokens', 4096);
        $this->temperature  = (float) config('services.bedrock.temperature', 0.7);
    }

    /**
     * 统一调用入口
     */
    public function chat(
        string $prompt,
        ?string $modelKey = null,
        array $options = []
    ): LLMResponse {
        $modelId  = $modelKey ? (self::MODELS[$modelKey] ?? $modelKey) : $this->defaultModel;
        $provider = $this->detectProvider($modelId);

        $requestBody = $this->buildRequestBody($provider, $prompt, $options);
        $startTime   = microtime(true);

        try {
            $result = $this->client->invokeModel([
                'modelId'     => $modelId,
                'contentType' => 'application/json',
                'accept'      => 'application/json',
                'body'        => json_encode($requestBody),
            ]);

            $response    = json_decode($result['body']->getContents(), true);
            $latency     = round((microtime(true) - $startTime) * 1000);
            $parsed      = $this->parseResponse($provider, $response);

            return new LLMResponse(
                content      : $parsed['content'],
                model        : $modelId,
                inputTokens  : $parsed['input_tokens'],
                outputTokens : $parsed['output_tokens'],
                latencyMs    : $latency,
                raw          : $response
            );

        } catch (BedrockRuntimeException $e) {
            Log::error('Bedrock API error', [
                'model'   => $modelId,
                'code'    => $e->getAwsErrorCode(),
                'message' => $e->getMessage(),
            ]);
            throw new LLMException("Bedrock 调用失败: {$e->getAwsErrorCode()}", $e);
        }
    }

    /**
     * 流式输出（适合需要逐字显示的场景）
     */
    public function chatStream(
        string $prompt,
        ?string $modelKey = null,
        array $options = []
    ): \Generator {
        $modelId  = $modelKey ? (self::MODELS[$modelKey] ?? $modelKey) : $this->defaultModel;
        $provider = $this->detectProvider($modelId);

        $requestBody = $this->buildRequestBody($provider, $prompt, $options, true);

        $result = $this->client->invokeModelWithResponseStream([
            'modelId'     => $modelId,
            'contentType' => 'application/json',
            'accept'      => 'application/json',
            'body'        => json_encode($requestBody),
        ]);

        $stream = $result['stream'];

        foreach ($stream as $event) {
            if (isset($event['chunk'])) {
                $chunk    = json_decode($event['chunk']->getContents(), true);
                $content  = $this->parseStreamChunk($provider, $chunk);
                if ($content !== null) {
                    yield $content;
                }
            }
        }
    }

    /**
     * 根据 modelId 自动识别 provider
     */
    private function detectProvider(string $modelId): string
    {
        if (str_starts_with($modelId, 'anthropic.')) return 'anthropic';
        if (str_starts_with($modelId, 'meta.'))      return 'meta';
        if (str_starts_with($modelId, 'amazon.'))    return 'amazon';
        if (str_starts_with($modelId, 'ai21.'))      return 'ai21';
        return 'unknown';
    }

    /**
     * 构建不同 provider 的请求体
     */
    private function buildRequestBody(
        string $provider,
        string $prompt,
        array $options,
        bool $stream = false
    ): array {
        $maxTokens   = $options['max_tokens']   ?? $this->maxTokens;
        $temperature = $options['temperature']  ?? $this->temperature;
        $system      = $options['system']       ?? null;

        return match ($provider) {
            'anthropic' => array_filter([
                'anthropic_version' => 'bedrock-2023-05-31',
                'max_tokens'        => $maxTokens,
                'temperature'       => $temperature,
                'system'            => $system,
                'messages'          => [['role' => 'user', 'content' => $prompt]],
                'stream'            => $stream,
            ]),
            'meta' => [
                'prompt'      => $this->buildLlamaPrompt($prompt, $system),
                'max_gen_len' => $maxTokens,
                'temperature' => $temperature,
            ],
            'amazon' => [
                'inputText'    => $prompt,
                'textGenConfig' => [
                    'maxTokenCount' => $maxTokens,
                    'temperature'   => $temperature,
                    'stopSequences' => [],
                ],
            ],
            default => throw new LLMException("不支持的 provider: {$provider}"),
        };
    }

    /**
     * 构建 Llama 3 的 Prompt 格式
     */
    private function buildLlamaPrompt(string $prompt, ?string $system): string
    {
        $parts = [];
        if ($system) {
            $parts[] = "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n{$system}<|eot_id|>";
        }
        $parts[] = "<|start_header_id|>user<|end_header_id|>\n{$prompt}<|eot_id|>";
        $parts[] = "<|start_header_id|>assistant<|end_header_id|>";
        return implode('', $parts);
    }

    /**
     * 解析不同 provider 的响应
     */
    private function parseResponse(string $provider, array $response): array
    {
        return match ($provider) {
            'anthropic' => [
                'content'      => $response['content'][0]['text'] ?? '',
                'input_tokens' => $response['usage']['input_tokens'] ?? 0,
                'output_tokens'=> $response['usage']['output_tokens'] ?? 0,
            ],
            'meta' => [
                'content'      => $response['generation'] ?? '',
                'input_tokens' => $response['prompt_token_count'] ?? 0,
                'output_tokens'=> $response['generation_token_count'] ?? 0,
            ],
            'amazon' => [
                'content'      => $response['results'][0]['outputText'] ?? '',
                'input_tokens' => $response['inputTextTokenCount'] ?? 0,
                'output_tokens'=> $response['results'][0]['tokenCount'] ?? 0,
            ],
        };
    }

    private function parseStreamChunk(string $provider, array $chunk): ?string
    {
        return match ($provider) {
            'anthropic' => $chunk['delta']['text'] ?? null,
            'meta'      => $chunk['generation'] ?? null,
            'amazon'    => $chunk['outputText'] ?? null,
        };
    }
}
```

### 响应值对象

创建 `app/Services/LLM/LLMResponse.php`：

```php
<?php

namespace App\Services\LLM;

class LLMResponse
{
    public function __construct(
        public readonly string $content,
        public readonly string $model,
        public readonly int    $inputTokens,
        public readonly int    $outputTokens,
        public readonly int    $latencyMs,
        public readonly ?array $raw = null,
    ) {}

    /**
     * 计算本次调用成本（美元）
     * 基于公开定价，实际以 AWS 账单为准
     */
    public function estimateCost(): float
    {
        $pricing = [
            'anthropic.claude-3-5-sonnet'  => ['input' => 3.00,  'output' => 15.00],
            'anthropic.claude-3-haiku'     => ['input' => 0.25,  'output' => 1.25],
            'anthropic.claude-3-opus'      => ['input' => 15.00, 'output' => 75.00],
            'meta.llama3-70b'              => ['input' => 0.65,  'output' => 0.65],
            'meta.llama3-8b'               => ['input' => 0.20,  'output' => 0.20],
            'amazon.titan-text-premier'    => ['input' => 0.50,  'output' => 0.85],
            'amazon.titan-text-express'    => ['input' => 0.13,  'output' => 0.17],
        ];

        foreach ($pricing as $prefix => $rates) {
            if (str_starts_with($this->model, $prefix)) {
                return ($this->inputTokens * $rates['input'] + $this->outputTokens * $rates['output']) / 1_000_000;
            }
        }

        return 0.0;
    }

    public function toArray(): array
    {
        return [
            'content'       => $this->content,
            'model'         => $this->model,
            'input_tokens'  => $this->inputTokens,
            'output_tokens' => $this->outputTokens,
            'latency_ms'    => $this->latencyMs,
            'estimated_cost'=> $this->estimateCost(),
        ];
    }
}
```

### 异常类

```php
<?php

namespace App\Services\LLM;

class LLMException extends \RuntimeException {}
```

## 服务注册与配置

`config/services.php` 添加：

```php
'bedrock' => [
    'region'        => env('AWS_DEFAULT_REGION', 'us-east-1'),
    'default_model' => env('AWS_BEDROCK_MODEL_DEFAULT', 'anthropic.claude-3-5-sonnet-20241022-v2:0'),
    'max_tokens'    => env('AWS_BEDROCK_MAX_TOKENS', 4096),
    'temperature'   => env('AWS_BEDROCK_TEMPERATURE', 0.7),
],
```

`app/Providers/AppServiceProvider.php` 注册：

```php
use App\Services\LLM\BedrockService;

$this->app->singleton(BedrockService::class, function () {
    return new BedrockService();
});
```

## 实战：路由与控制器

### 基础聊天接口

```php
// routes/api.php
Route::post('/llm/chat', [LLMController::class, 'chat']);
Route::get('/llm/stream', [LLMController::class, 'stream']); // SSE 流式
Route::get('/llm/models', [LLMController::class, 'models']);
```

```php
<?php

namespace App\Http\Controllers;

use App\Services\LLM\BedrockService;
use App\Services\LLM\LLMException;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

class LLMController extends Controller
{
    public function __construct(
        private BedrockService $llm
    ) {}

    /**
     * 非流式聊天
     */
    public function chat(Request $request): JsonResponse
    {
        $request->validate([
            'prompt'     => 'required|string|max:32000',
            'model'      => 'nullable|string',
            'system'     => 'nullable|string|max:5000',
            'max_tokens' => 'nullable|integer|min:1|max:8192',
        ]);

        try {
            $response = $this->llm->chat(
                prompt  : $request->input('prompt'),
                modelKey: $request->input('model'),
                options : array_filter([
                    'system'     => $request->input('system'),
                    'max_tokens' => $request->input('max_tokens'),
                ])
            );

            return response()->json([
                'success' => true,
                'data'    => $response->toArray(),
            ]);

        } catch (LLMException $e) {
            return response()->json([
                'success' => false,
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * SSE 流式输出
     */
    public function stream(Request $request): StreamedResponse
    {
        $request->validate([
            'prompt' => 'required|string|max:32000',
            'model'  => 'nullable|string',
            'system' => 'nullable|string|max:5000',
        ]);

        return response()->stream(function () use ($request) {
            $generator = $this->llm->chatStream(
                prompt  : $request->input('prompt'),
                modelKey: $request->input('model'),
                options : array_filter([
                    'system' => $request->input('system'),
                ])
            );

            foreach ($generator as $chunk) {
                echo "data: " . json_encode(['content' => $chunk]) . "\n\n";
                if (ob_get_level() > 0) ob_flush();
                flush();
            }

            echo "data: [DONE]\n\n";
        }, 200, [
            'Content-Type'  => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection'    => 'keep-alive',
        ]);
    }

    /**
     * 列出可用模型
     */
    public function models(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => array_map(fn ($id) => [
                'id'        => $id,
                'provider'  => explode('.', $id)[0],
            ], BedrockService::MODELS),
        ]);
    }
}
```

## Token 追踪与成本监控

生产环境必须追踪每次调用的 Token 消耗和成本。创建一张追踪表：

```php
// database/migrations/xxxx_create_llm_usage_logs_table.php
Schema::create('llm_usage_logs', function (Blueprint $table) {
    $table->id();
    $table->string('model', 100);
    $table->string('provider', 20);
    $table->integer('input_tokens');
    $table->integer('output_tokens');
    $table->decimal('estimated_cost', 10, 8);
    $table->integer('latency_ms');
    $table->string('context', 50)->nullable(); // 业务场景标记
    $table->string('user_id', 36)->nullable();
    $table->timestamps();

    $table->index(['model', 'created_at']);
    $table->index(['context', 'created_at']);
});
```

创建一个中间件自动记录：

```php
<?php

namespace App\Http\Middleware;

use App\Models\LlmUsageLog;
use Closure;
use Illuminate\Http\Request;

class TrackLlmUsage
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 从 request attribute 取出 LLM 响应
        $llmResponse = $request->attributes->get('llm_response');
        if ($llmResponse) {
            LlmUsageLog::create([
                'model'         => $llmResponse->model,
                'provider'      => explode('.', $llmResponse->model)[0],
                'input_tokens'  => $llmResponse->inputTokens,
                'output_tokens' => $llmResponse->outputTokens,
                'estimated_cost'=> $llmResponse->estimateCost(),
                'latency_ms'    => $llmResponse->latencyMs,
                'context'       => $request->input('context', 'general'),
                'user_id'       => $request->user()?->id,
            ]);
        }

        return $response;
    }
}
```

## 成本优化策略

### 1. 智能路由：根据任务复杂度选模型

```php
<?php

namespace App\Services\LLM;

class ModelRouter
{
    /**
     * 根据任务类型自动选择最优模型
     */
    public static function selectModel(string $taskType, int $promptLength = 0): string
    {
        return match ($taskType) {
            // 简单分类、提取、格式化 → 最便宜的
            'classify', 'extract', 'format' => 'llama3-8b',

            // 一般对话、客服 → 平衡性价比
            'chat', 'support' => 'claude-haiku',

            // 复杂推理、代码生成、长文本 → 高质量
            'reason', 'code', 'analysis' => 'claude-sonnet',

            // 翻译 → 看长度
            'translate' => $promptLength > 5000 ? 'claude-sonnet' : 'claude-haiku',

            // 摘要 → 中等质量即可
            'summarize' => $promptLength > 10000 ? 'claude-sonnet' : 'claude-haiku',

            // AWS 原生场景（低延迟要求）
            'aws-native' => 'titan-express',

            default => 'claude-haiku',
        };
    }
}
```

### 2. 响应缓存

相同 Prompt 的重复调用是最大的成本浪费。用 Redis 做语义缓存：

```php
<?php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class CachedBedrockService
{
    public function __construct(
        private BedrockService $bedrock,
        private int $cacheTtl = 3600, // 默认缓存 1 小时
    ) {}

    public function chat(string $prompt, ?string $modelKey = null, array $options = []): LLMResponse
    {
        $cacheKey = $this->buildCacheKey($prompt, $modelKey, $options);

        // 检查缓存
        $cached = Cache::get($cacheKey);
        if ($cached) {
            return unserialize($cached);
        }

        $response = $this->bedrock->chat($prompt, $modelKey, $options);

        // 只缓存成功的非流式响应
        if ($response->outputTokens > 0) {
            Cache::put($cacheKey, serialize($response), $this->cacheTtl);
        }

        return $response;
    }

    private function buildCacheKey(string $prompt, ?string $modelKey, array $options): string
    {
        $hash = md5(json_encode([
            'prompt'  => $prompt,
            'model'   => $modelKey,
            'options' => $options,
        ]));
        return "llm:cache:{$hash}";
    }
}
```

### 3. 请求合并与限流

高频场景下，用 Laravel 的 RateLimiter 防止意外账单爆炸：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::for('llm-api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?? $request->ip());
});
```

### 4. Prompt 工程优化

Token 消耗的最大变量是 Prompt 本身。几个实战技巧：

- **精简 System Prompt**：把 2000 字的系统指令压缩到 500 字以内，效果几乎不变
- **Few-shot 优化**：示例从 5 个减到 2-3 个，对 Claude 来说足够
- **输出格式约束**：明确要求 `JSON` 格式输出，避免模型「废话」
- **分批处理**：大文档拆成小块分批调用，比一次性塞进去更便宜

## 生产踩坑记录

### 踩坑 1：ThrottlingException

Bedrock 有并发限制，高并发时会报 `ThrottlingException`。

```php
// 解决方案：指数退避重试
use Aws\RetryMiddleware;

$client = new BedrockRuntimeClient([
    'region'      => 'us-east-1',
    'retries'     => 5,
    'retry'       => [
        'delay'     => function ($retries) {
            return min(1000 * pow(2, $retries), 30000); // 最长等 30 秒
        },
        'decider'   => function ($retries, $command, $request, $result, $error) {
            return $retries < 5 && ($error instanceof ThrottlingException);
        },
    ],
]);
```

### 踩坑 2：Claude 的 Context Window

Claude 3.5 Sonnet 支持 200K Token 上下文，但**实际使用时超过 50K Token 延迟会显著增加**，成本也线性增长。建议：

- 200K 上下文是「能力上限」，不是「推荐用量」
- 实际业务控制在 10K-30K Token 最佳
- 超长文档先用 Haiku 做摘要，再用 Sonnet 做深度分析

### 踩坑 3：Llama 的 Prompt 格式

Llama 3 对 Prompt 格式非常敏感。如果不用 `<|begin_of_text|>` 等特殊标记包裹，输出质量会明显下降。代码中 `buildLlamaPrompt` 方法已经处理了这个问题。

### 踩坑 4：跨区域延迟

如果服务器在 `ap-southeast-1`（新加坡），调用 `us-east-1` 的 Bedrock 会增加 150-200ms 延迟。解决方案：

```php
// 多区域配置
'bedrock' => [
    'regions' => [
        'primary'   => 'us-east-1',  // 模型最全
        'secondary' => 'ap-southeast-1', // 延迟最低，但模型较少
    ],
    'region_strategy' => 'latency', // 或 'availability'
],
```

在 Service 构造函数中根据策略选择 region，主区域不可用时自动降级。

### 踩坑 5：流式输出的 Nginx 缓冲

Nginx 默认会缓冲响应，导致 SSE 流式输出看不到中间数据。配置：

```nginx
location /api/llm/stream {
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
}
```

## 与 Laravel 队列集成

对于不需要实时返回的任务（如批量文档处理），用队列异步调用：

```php
<?php

namespace App\Jobs;

use App\Services\LLM\BedrockService;
use App\Services\LLM\ModelRouter;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProcessLLMTask implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        private string $prompt,
        private string $taskType,
        private string $context,
        private ?string $callbackUrl = null,
    ) {}

    public function handle(BedrockService $llm)
    {
        $model = ModelRouter::selectModel($this->taskType, strlen($this->prompt));

        $response = $llm->chat($this->prompt, $model, [
            'system' => match ($this->taskType) {
                'code'     => 'You are a senior PHP/Laravel developer.',
                'analysis' => 'You are a data analyst. Output JSON only.',
                default    => null,
            },
        ]);

        // 回调通知
        if ($this->callbackUrl) {
            \Http::post($this->callbackUrl, [
                'context' => $this->context,
                'result'  => $response->toArray(),
            ]);
        }

        return $response->toArray();
    }
}
```

## 总结

AWS Bedrock 在 Laravel 项目中的接入并不复杂，核心工作量在「统一封装」和「成本控制」两块：

1. **统一抽象层**是关键——不同模型的请求/响应格式差异很大，封装好之后上层业务完全不用关心底层是哪个模型
2. **成本优化三板斧**：智能路由（便宜模型做简单任务）、响应缓存（避免重复调用）、Prompt 精简（减少 Token 消耗）
3. **生产环境必做**：Token 追踪、限流、重试、流式输出的 Nginx 配置
4. **模型选择建议**：默认用 Claude Haiku（性价比最高），复杂任务升级 Sonnet，轻量任务降级 Llama 8B

Bedrock 的优势在于不用自己维护 GPU 集群，不用操心模型部署，按量计费对中小团队非常友好。劣势是模型更新有时差（比官方 API 慢 1-2 周），以及部分模型需要单独申请访问权限。

如果你的团队已经在用 AWS，Bedrock 是目前接入 LLM 最省心的方案。如果不在 AWS 生态内，可以对比 Azure OpenAI 和 Google Vertex AI，但 Bedrock 的模型丰富度和定价透明度目前是最优的。
