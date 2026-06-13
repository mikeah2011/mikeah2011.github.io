---
title: "LLM Router 实战：OpenRouter/Portkey/LiteLLM 统一模型路由——多提供商 Failover、成本优化与延迟感知的工程化网关"
keywords: [LLM Router, OpenRouter, Portkey, LiteLLM, Failover, 统一模型路由, 多提供商, 成本优化与延迟感知的工程化网关, AI]
date: 2026-06-09 17:49:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - LLM
  - OpenRouter
  - Portkey
  - LiteLLM
  - API Gateway
  - Failover
  - 成本优化
description: "在生产环境中对接多个 LLM 提供商时，统一模型路由、自动 Failover、成本优化和延迟感知是必须解决的工程问题。本文从零搭建一个 LLM Router 网关，覆盖 OpenRouter、Portkey、LiteLLM 三种方案的选型对比与实战落地。"
---


## 为什么需要 LLM Router

当你的应用只对接一个 LLM 提供商时，直接调 API 就够了。但现实情况往往是：

- OpenAI 的 GPT-4o 便宜但偶发超时
- Claude 在长文本任务上表现更好
- 国内模型（Qwen、DeepSeek）延迟低但能力有限
- 同一个模型在不同提供商价格不同

这时候你需要一个 **统一入口**，把所有模型请求先经过 Router，再分发到具体提供商。Router 负责三件事：

1. **Failover**：某个提供商挂了，自动切到备用
2. **成本优化**：同一个请求选最便宜的可用提供商
3. **延迟感知**：优先选响应快的节点

## 三种主流方案对比

| 特性 | OpenRouter | Portkey | LiteLLM |
|------|-----------|---------|---------|
| 部署方式 | SaaS | SaaS + 自托管 | 纯自托管 |
| 模型数量 | 100+ | 250+ | 100+ |
| Failover | 简单重试 | 高级策略 | 完整控制 |
| 成本追踪 | 基础 | 详细 | 自定义 |
| 适合场景 | 快速原型 | 企业级 | 完全自控 |

**选型建议**：
- 想快速开始 → OpenRouter
- 要企业级监控 → Portkey
- 要完全自控 → LiteLLM

下面分别实战。

## 方案一：OpenRouter 快速接入

OpenRouter 本质是一个 API 代理，你用它的 endpoint 替换 OpenAI 的，它帮你路由到实际模型。

### 基本接入

```php
<?php
// app/Services/LLM/OpenRouterClient.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OpenRouterClient
{
    private string $apiKey;
    private string $baseUrl = 'https://openrouter.ai/api/v1';
    private string $siteName;
    private string $siteUrl;

    public function __construct()
    {
        $this->apiKey = config('services.openrouter.key');
        $this->siteName = config('services.openrouter.site_name', 'MyApp');
        $this->siteUrl = config('services.openrouter.site_url', 'https://myapp.com');
    }

    public function chat(string $model, array $messages, array $options = []): array
    {
        $payload = array_merge([
            'model' => $model,
            'messages' => $messages,
        ], $options);

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'HTTP-Referer' => $this->siteUrl,
            'X-Title' => $this->siteName,
            'Content-Type' => 'application/json',
        ])->timeout(60)->post("{$this->baseUrl}/chat/completions", $payload);

        if ($response->failed()) {
            Log::error('OpenRouter request failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("OpenRouter request failed: {$response->status()}");
        }

        return $response->json();
    }

    /**
     * 获取可用模型列表及价格
     */
    public function getModels(): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
        ])->get("{$this->baseUrl}/models");

        return $response->json('data', []);
    }

    /**
     * 按能力筛选最便宜的模型
     */
    public function getCheapestModel(string $capability = 'chat'): ?string
    {
        $models = $this->getModels();

        $candidates = array_filter($models, function ($model) use ($capability) {
            $pricing = $model['pricing'] ?? null;
            return $pricing && ($pricing['prompt'] ?? 0) > 0;
        });

        usort($candidates, function ($a, $b) {
            $priceA = (float)($a['pricing']['prompt'] ?? 0);
            $priceB = (float)($b['pricing']['prompt'] ?? 0);
            return $priceA <=> $priceB;
        });

        return $candidates[0]['id'] ?? null;
    }
}
```

### 带 Failover 的调用

```php
<?php
// app/Services/LLM/OpenRouterFailover.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Log;

class OpenRouterFailover
{
    private OpenRouterClient $client;
    private array $modelChain;

    public function __construct(OpenRouterClient $client)
    {
        $this->client = $client;
        $this->modelChain = [
            'openai/gpt-4o',
            'anthropic/claude-3.5-sonnet',
            'google/gemini-pro-1.5',
            'meta-llama/llama-3.1-70b-instruct',
        ];
    }

    public function chatWithFailover(array $messages, array $options = []): array
    {
        $lastException = null;

        foreach ($this->modelChain as $model) {
            try {
                Log::info("Trying model: {$model}");
                $result = $this->client->chat($model, $messages, $options);

                Log::info("Success with model: {$model}", [
                    'usage' => $result['usage'] ?? null,
                ]);

                return $result;
            } catch (\Throwable $e) {
                $lastException = $e;
                Log::warning("Model {$model} failed: {$e->getMessage()}");
                continue;
            }
        }

        throw new \RuntimeException(
            'All models in chain failed',
            0,
            $lastException
        );
    }
}
```

OpenRouter 的 Failover 比较简单——就是按顺序试。适合快速原型，但不够精细。

## 方案二：Portkey 企业级路由

Portkey 提供了更高级的路由策略，包括条件路由、负载均衡、语义缓存。

### 安装与配置

```bash
composer require portkey/portkey-php
```

```php
<?php
// config/services.php 中添加

'portkey' => [
    'api_key' => env('PORTKEY_API_KEY'),
    'virtual_key' => env('PORTKEY_VIRTUAL_KEY'),
],
```

### 定义路由策略

```php
<?php
// app/Services/LLM/PortkeyRouter.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PortkeyRouter
{
    private string $apiKey;
    private string $baseUrl = 'https://api.portkey.ai/v1';

    public function __construct()
    {
        $this->apiKey = config('services.portkey.api_key');
    }

    /**
     * 带 Failover + 负载均衡的路由
     *
     * Portkey 的 config 格式定义了路由规则：
     * - strategy: fallback / loadbalance / latency-based
     * - targets: 各个提供商配置
     */
    public function createFallbackConfig(): array
    {
        return [
            'strategy' => [
                'mode' => 'fallback',
            ],
            'targets' => [
                [
                    'provider' => 'openai',
                    'model' => 'gpt-4o',
                    'weight' => 1,
                    'virtual_key' => config('services.portkey.keys.openai'),
                ],
                [
                    'provider' => 'anthropic',
                    'model' => 'claude-3-5-sonnet-20241022',
                    'weight' => 1,
                    'virtual_key' => config('services.portkey.keys.anthropic'),
                ],
                [
                    'provider' => 'google',
                    'model' => 'gemini-pro-1.5',
                    'weight' => 1,
                    'virtual_key' => config('services.portkey.keys.google'),
                ],
            ],
        ];
    }

    /**
     * 成本优先路由：优先用便宜的，挂了再切
     */
    public function createCostOptimizedConfig(): array
    {
        return [
            'strategy' => [
                'mode' => 'loadbalance',
            ],
            'targets' => [
                // DeepSeek 最便宜
                [
                    'provider' => 'deepseek',
                    'model' => 'deepseek-chat',
                    'weight' => 5, // 50% 流量
                    'virtual_key' => config('services.portkey.keys.deepseek'),
                ],
                // Qwen 次便宜
                [
                    'provider' => 'qwen',
                    'model' => 'qwen-plus',
                    'weight' => 3, // 30% 流量
                    'virtual_key' => config('services.portkey.keys.qwen'),
                ],
                // GPT-4o 保底
                [
                    'provider' => 'openai',
                    'model' => 'gpt-4o',
                    'weight' => 2, // 20% 流量
                    'virtual_key' => config('services.portkey.keys.openai'),
                ],
            ],
        ];
    }

    /**
     * 延迟优先路由：优先选响应快的
     */
    public function createLatencyOptimizedConfig(): array
    {
        return [
            'strategy' => [
                'mode' => 'latency-based',
                'max_latency' => 2000, // 2 秒超时
            ],
            'targets' => [
                [
                    'provider' => 'openai',
                    'model' => 'gpt-4o-mini',
                    'virtual_key' => config('services.portkey.keys.openai'),
                ],
                [
                    'provider' => 'anthropic',
                    'model' => 'claude-3-haiku-20240307',
                    'virtual_key' => config('services.portkey.keys.anthropic'),
                ],
            ],
        ];
    }

    /**
     * 发送请求（带路由配置）
     */
    public function chat(array $config, array $messages, array $options = []): array
    {
        $payload = array_merge([
            'messages' => $messages,
        ], $options);

        $response = Http::withHeaders([
            'x-portkey-api-key' => $this->apiKey,
            'x-portkey-config' => json_encode($config),
            'Content-Type' => 'application/json',
        ])->timeout(120)->post("{$this->baseUrl}/chat/completions", $payload);

        if ($response->failed()) {
            Log::error('Portkey request failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("Portkey request failed: {$response->status()}");
        }

        return $response->json();
    }
}
```

### 实际使用

```php
<?php
// 调用示例

$router = app(PortkeyRouter::class);

// 普通请求：用 Failover 策略
$result = $router->chat(
    $router->createFallbackConfig(),
    [
        ['role' => 'system', 'content' => '你是一个技术助手'],
        ['role' => 'user', 'content' => '解释 Laravel 的 Service Container'],
    ]
);

// 成本敏感任务：用成本优化策略
$result = $router->chat(
    $router->createCostOptimizedConfig(),
    $messages
);
```

## 方案三：LiteLLM 完全自控

LiteLLM 是 Python 生态，但可以通过 Docker 部署成 API 服务，然后任何语言都能调。

### Docker 部署

```yaml
# docker-compose.yml

version: '3.8'

services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    volumes:
      - ./litellm_config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
    restart: unless-stopped

  # 监控面板
  litellm-dashboard:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4001:4001"
    command: ["--config", "/app/config.yaml", "--port", "4001", "--ui"]
    depends_on:
      - litellm
```

### 路由配置

```yaml
# litellm_config.yaml

model_list:
  # GPT-4o
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
      rpm: 500
      timeout: 30

  # Claude
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-3-5-sonnet-20241022
      api_key: os.environ/ANTHROPIC_API_KEY
      rpm: 300

  # DeepSeek（便宜）
  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY
      rpm: 1000

  # 通用路由：自动选最便宜的
  - model_name: auto-cheapest
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      max_input_tokens: 128000

router_settings:
  routing_strategy: latency-based  # latency-based / least-busy / cost-based
  num_retries: 3
  timeout: 60
  allowed_fails: 2
  cooldown_time: 30
  enable_pre_call_checks: true

general_settings:
  master_key: sk-litellm-master-key
  database_url: sqlite:///litellm.db  # 用于追踪用量
```

### 从 Laravel 调用 LiteLLM

```php
<?php
// app/Services/LLM/LiteLLMClient.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class LiteLLMClient
{
    private string $baseUrl;
    private string $masterKey;

    public function __construct()
    {
        $this->baseUrl = config('services.litellm.url', 'http://localhost:4000');
        $this->masterKey = config('services.litellm.master_key');
    }

    /**
     * 统一调用接口
     *
     * model 可以是：
     * - gpt-4o（直接指定）
     * - auto-cheapest（走自动路由）
     * - 任何 litellm_config.yaml 中定义的 model_name
     */
    public function chat(string $model, array $messages, array $options = []): array
    {
        $payload = array_merge([
            'model' => $model,
            'messages' => $messages,
        ], $options);

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->masterKey}",
            'Content-Type' => 'application/json',
        ])->timeout(120)->post("{$this->baseUrl}/v1/chat/completions", $payload);

        if ($response->failed()) {
            Log::error('LiteLLM request failed', [
                'model' => $model,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("LiteLLM request failed: {$response->status()}");
        }

        return $response->json();
    }

    /**
     * 获取当前路由状态
     */
    public function getRouterStatus(): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->masterKey}",
        ])->get("{$this->baseUrl}/router/status");

        return $response->json();
    }

    /**
     * 获取用量统计
     */
    public function getUsage(string $startDate, string $endDate): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->masterKey}",
        ])->get("{$this->baseUrl}/spend/logs", [
            'start_date' => $startDate,
            'end_date' => $endDate,
        ]);

        return $response->json();
    }
}
```

## 统一封装：Laravel Service Provider

不管用哪个方案，最终在应用层应该有统一的接口。

```php
<?php
// app/Services/LLM/LLMRouter.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Log;

class LLMRouter
{
    private array $providers = [];
    private string $defaultProvider;

    public function __construct()
    {
        $this->defaultProvider = config('services.llm.default', 'litellm');
    }

    /**
     * 注册提供商
     */
    public function registerProvider(string $name, LLMProviderInterface $provider): void
    {
        $this->providers[$name] = $provider;
    }

    /**
     * 发送请求（自动 Failover）
     */
    public function chat(string $model, array $messages, array $options = []): array
    {
        $providerOrder = $this->getProviderOrder();

        foreach ($providerOrder as $providerName) {
            $provider = $this->providers[$providerName] ?? null;
            if (!$provider) continue;

            try {
                $result = $provider->chat($model, $messages, $options);

                Log::info('LLM request success', [
                    'provider' => $providerName,
                    'model' => $model,
                    'tokens' => $result['usage'] ?? null,
                ]);

                return $result;
            } catch (\Throwable $e) {
                Log::warning("Provider {$providerName} failed", [
                    'error' => $e->getMessage(),
                ]);
                continue;
            }
        }

        throw new \RuntimeException('All LLM providers failed');
    }

    private function getProviderOrder(): array
    {
        // 默认提供商排第一，其余按配置顺序
        $order = [$this->defaultProvider];
        foreach (array_keys($this->providers) as $name) {
            if ($name !== $this->defaultProvider) {
                $order[] = $name;
            }
        }
        return $order;
    }
}

// 接口定义
interface LLMProviderInterface
{
    public function chat(string $model, array $messages, array $options = []): array;
}
```

### 注册 Service Provider

```php
<?php
// app/Providers/LLMServiceProvider.php

namespace App\Providers;

use App\Services\LLM\LiteLLMClient;
use App\Services\LLM\LLMRouter;
use App\Services\LLM\OpenRouterClient;
use App\Services\LLM\PortkeyRouter;
use Illuminate\Support\ServiceProvider;

class LLMServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(LLMRouter::class, function ($app) {
            $router = new LLMRouter();

            // 注册 LiteLLM（自托管）
            if (config('services.litellm.url')) {
                $router->registerProvider('litellm', new LiteLLMClient());
            }

            // 注册 OpenRouter
            if (config('services.openrouter.key')) {
                $router->registerProvider('openrouter', new OpenRouterClient());
            }

            return $router;
        });
    }
}
```

## 踩坑记录

### 坑 1：OpenRouter 的模型名格式

OpenRouter 要求模型名带提供商前缀，比如 `openai/gpt-4o` 而不是 `gpt-4o`。写错了会返回 400 但错误信息不明确。

```php
// 错误
$model = 'gpt-4o';

// 正确
$model = 'openai/gpt-4o';
```

### 坑 2：Portkey 的虚拟 Key 泄露

Portkey 的 virtual_key 不是 API key，它是映射到你实际 key 的标识符。但如果你把 virtual_key 直接写在前端代码里，别人可以用它调你的模型。务必放在后端。

### 坑 3：LiteLLM 的超时问题

LiteLLM 默认 timeout 是 30 秒，但某些模型（特别是长文本生成）可能需要更长时间。建议：

```yaml
# litellm_config.yaml
router_settings:
  timeout: 120  # 全局超时
  stream_timeout: 300  # 流式超时
```

### 坑 4：Failover 的幂等性

如果你的请求带有 `temperature=0`，Failover 后重试是安全的。但如果 `temperature>0`，重试会得到不同的结果。对于需要确定性的场景（比如代码生成），要特别注意。

### 坑 5：成本追踪不一致

不同提供商的 token 计算方式不同。同一个 prompt，在 OpenAI 和 Anthropic 上的 token 数可能差 20%。做成本对比时要以实际账单为准，不要只看 API 返回的 usage。

### 坑 6：LiteLLM 的 SQLite 并发

LiteLLM 默认用 SQLite 存用量数据，高并发时会锁表。生产环境换成 PostgreSQL：

```yaml
general_settings:
  database_url: postgresql://user:pass@localhost:5432/litellm
```

## 成本优化实战

### 按任务类型路由

不同任务用不同模型，成本可以降 70%：

```php
<?php
// app/Services/LLM/TaskRouter.php

namespace App\Services\LLM;

class TaskRouter
{
    private LLMRouter $router;

    // 任务类型 → 模型映射
    private array $taskModelMap = [
        // 简单分类/提取：用最便宜的
        'classify' => 'deepseek-chat',
        'extract' => 'gpt-4o-mini',

        // 中等复杂度：用性价比高的
        'summarize' => 'claude-3-haiku-20240307',
        'translate' => 'qwen-plus',

        // 复杂推理：用最强的
        'reason' => 'gpt-4o',
        'code' => 'claude-3-5-sonnet-20241022',
        'write' => 'gpt-4o',
    ];

    public function __construct(LLMRouter $router)
    {
        $this->router = $router;
    }

    public function handleTask(string $taskType, string $prompt, array $context = []): string
    {
        $model = $this->taskModelMap[$taskType] ?? 'gpt-4o-mini';

        $messages = [
            ['role' => 'system', 'content' => $this->getSystemPrompt($taskType)],
            ['role' => 'user', 'content' => $prompt],
        ];

        $result = $this->router->chat($model, $messages);

        return $result['choices'][0]['message']['content'] ?? '';
    }

    private function getSystemPrompt(string $taskType): string
    {
        $prompts = [
            'classify' => '你是一个文本分类器。只输出分类标签，不要解释。',
            'extract' => '你是一个信息提取器。提取关键信息，用 JSON 格式输出。',
            'summarize' => '你是一个摘要生成器。用简洁的语言概括核心内容。',
            'translate' => '你是一个专业翻译。保持原文风格，准确翻译。',
            'reason' => '你是一个逻辑推理专家。逐步分析，给出结论。',
            'code' => '你是一个资深程序员。写可运行的代码，包含必要注释。',
            'write' => '你是一个写作助手。用清晰、有结构的方式表达。',
        ];

        return $prompts[$taskType] ?? '你是一个通用助手。';
    }
}
```

### Token 预算控制

```php
<?php
// app/Services/LLM/BudgetGuard.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Cache;

class BudgetGuard
{
    private float $dailyBudget; // 美元
    private float $monthlyBudget;

    public function __construct()
    {
        $this->dailyBudget = (float) config('services.llm.budget.daily', 10.0);
        $this->monthlyBudget = (float) config('services.llm.budget.monthly', 200.0);
    }

    /**
     * 检查是否还有预算
     */
    public function canSpend(float $estimatedCost): bool
    {
        $dailySpent = $this->getDailySpend();
        $monthlySpent = $this->getMonthlySpend();

        return ($dailySpent + $estimatedCost) <= $this->dailyBudget
            && ($monthlySpent + $estimatedCost) <= $this->monthlyBudget;
    }

    /**
     * 记录消费
     */
    public function recordSpend(float $amount, string $model, string $provider): void
    {
        $dailyKey = 'llm_spend:' . date('Y-m-d');
        $monthlyKey = 'llm_spend:' . date('Y-m');

        Cache::increment($dailyKey, (int) ($amount * 10000)); // 存为万分之一美元
        Cache::increment($monthlyKey, (int) ($amount * 10000));

        // 记录明细
        $detailsKey = 'llm_spend_details:' . date('Y-m-d');
        $details = Cache::get($detailsKey, []);
        $details[] = [
            'model' => $model,
            'provider' => $provider,
            'amount' => $amount,
            'time' => now()->toISOString(),
        ];
        Cache::put($detailsKey, $details, 86400 * 32);
    }

    public function getDailySpend(): float
    {
        return Cache::get('llm_spend:' . date('Y-m-d'), 0) / 10000;
    }

    public function getMonthlySpend(): float
    {
        return Cache::get('llm_spend:' . date('Y-m'), 0) / 10000;
    }
}
```

## 监控与告警

```php
<?php
// app/Services/LLM/LLMMonitor.php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use App\Notifications\LLMBudgetAlert;

class LLMMonitor
{
    /**
     * 记录每次请求的关键指标
     */
    public function logRequest(array $metrics): void
    {
        Log::info('LLM request metrics', [
            'provider' => $metrics['provider'],
            'model' => $metrics['model'],
            'latency_ms' => $metrics['latency_ms'],
            'prompt_tokens' => $metrics['prompt_tokens'] ?? 0,
            'completion_tokens' => $metrics['completion_tokens'] ?? 0,
            'cost_usd' => $metrics['cost_usd'] ?? 0,
            'success' => $metrics['success'],
            'error' => $metrics['error'] ?? null,
        ]);

        // 检查是否需要告警
        $this->checkAlerts($metrics);
    }

    private function checkAlerts(array $metrics): void
    {
        // 延迟告警
        if (($metrics['latency_ms'] ?? 0) > 10000) {
            Log::warning('LLM high latency alert', $metrics);
        }

        // 失败率告警
        $failRate = $this->getRecentFailRate($metrics['provider']);
        if ($failRate > 0.3) {
            Log::error('LLM high fail rate alert', [
                'provider' => $metrics['provider'],
                'fail_rate' => $failRate,
            ]);
        }
    }

    private function getRecentFailRate(string $provider): float
    {
        // 实现：从缓存/数据库获取最近 N 次请求的失败率
        return 0.0;
    }
}
```

## 总结

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 快速原型/MVP | OpenRouter | 一行代码接入，零运维 |
| 企业级生产 | Portkey | 丰富策略、监控面板、合规审计 |
| 完全自控 | LiteLLM | 开源、可定制、数据不出境 |
| 多方案混合 | 统一封装 | LLMRouter 抽象层 + 按需切换 |

**核心原则**：

1. **永远不要只依赖一个提供商**——至少配两个 Failover
2. **按任务类型选模型**——简单任务用小模型，成本降 70%
3. **设置预算上限**——防止意外的 token 消耗
4. **监控延迟和失败率**——问题要在用户发现之前解决
5. **Token 计算要留余量**——不同提供商的 tokenizer 不同，留 20% buffer

LLM Router 不是可选组件，是生产环境的基础设施。花一天搭好，后面省下的钱和避免的事故远超投入。
