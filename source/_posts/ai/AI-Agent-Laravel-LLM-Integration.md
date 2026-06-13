---
title: AI Agent + Laravel 实战：在 PHP 后端中集成 LLM 能力
date: 2026-06-02 02:31:05
tags: [AI, Laravel, LLM, PHP]
keywords: [AI Agent, Laravel, PHP, LLM, 后端中集成, 能力, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 这篇文章系统拆解 AI Agent 在 Laravel 与 PHP 后端集成 LLM 的完整实践路径，涵盖统一接口设计、多 Provider 接入、Streaming 流式输出、Prompt 管理、队列异步、成本控制与故障降级，帮助你把 AI 能力真正落进可维护、可审计、可扩展的后端集成体系。
---


在过去两年里，很多团队谈到“AI 落地”时，第一反应仍然是做一个聊天页面，接上某个模型 API，然后在前端展示回答。但如果你真正做过业务系统，就会很快发现：AI 能力真正稳定地产生价值，往往不是停留在一个孤立的 Chat 界面，而是深入到后端服务里，变成内容生成、知识问答、工单归类、风险审核、数据提取、文本改写、邮件草拟、运营辅助、代码解释、搜索增强等一系列可编排的服务能力。

对于 PHP 技术栈、尤其是 Laravel 团队来说，这件事的价值很直接：你不需要推翻已有系统，也不需要为了接入 LLM 重写整套基础设施。Laravel 本身就拥有成熟的配置系统、依赖注入容器、Service Provider、队列、缓存、事件、日志、HTTP Client、任务调度、异常处理和测试工具链。把 LLM 接入 Laravel，不只是“调一个 API”，而是在现有后端工程体系内，把模型能力变成一个可靠、可追踪、可计费、可降级、可维护的领域服务。

这篇文章我会结合实际项目经验，系统讲清楚如何在 Laravel 后端中集成 LLM 能力。文章不只是贴几段请求代码，而是从架构抽象、Provider 封装、流式输出、成本控制、Prompt 管理、失败重试、队列异步到真实踩坑，给出一套足够接近生产的方案。

---

## 一、为什么要在 Laravel 后端集成 LLM

很多团队刚开始做 AI 功能时，会把所有调用都堆到前端，原因很简单：快。前端直接请求模型接口，看起来开发效率最高。但随着需求增长，你会发现这条路很快遇到工程瓶颈。

### 1.1 前端直连模型 API 的问题

前端直连最典型的问题有四类：

1. **密钥暴露风险**：无论你做多少代理或混淆，只要前端直接调用第三方模型 API，密钥与鉴权都更容易泄露。
2. **Prompt 难以统一管理**：一旦不同页面、不同团队成员各自写 Prompt，系统很快失控，版本不可追踪。
3. **日志与审计缺失**：你无法完整记录一次请求用了什么模型、多少 token、返回了什么、失败原因是什么。
4. **业务上下文不完整**：真正有效的 Prompt 往往依赖订单、用户画像、权限、知识库、历史行为等服务端数据，这些数据本来就更适合在后端聚合。

### 1.2 为什么 Laravel 特别适合承载 LLM 能力

Laravel 在这件事上的优势，不是它“能发 HTTP 请求”，而是它把一整套工程能力都准备好了：

```php
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiSummaryController
{
    public function __invoke()
    {
        $response = Http::timeout(30)
            ->withToken(config('services.openai.key'))
            ->post('https://api.openai.com/v1/responses', [
                'model' => 'gpt-4.1-mini',
                'input' => '请总结 Laravel 队列的核心机制',
            ]);

        Log::info('LLM request finished', [
            'status' => $response->status(),
            'body' => $response->json(),
        ]);

        return $response->json();
    }
}
```

上面这段代码当然很基础，但它体现了 Laravel 的底层优势：

- `config()` 可以切换不同模型与环境；
- `Http` Client 自带超时、重试、中间件能力；
- `Log`、事件、异常处理链路天然完整；
- 服务容器让你可以把“模型调用能力”封装成统一接口；
- 队列系统可以把长耗时任务异步化；
- 缓存和数据库可以做 Prompt 版本管理、结果缓存、用量追踪；
- 测试框架便于 Mock 第三方 API，做稳定回归。

### 1.3 后端集成带来的业务收益

把 LLM 放到 Laravel 后端后，典型业务收益通常包括：

#### 统一 AI 网关

无论前台 H5、管理后台、内部运营工具还是定时任务，全部通过后端调用统一 AI 服务层。

```php
interface LlmClientInterface
{
    public function chat(array $messages, array $options = []): array;
}
```

这意味着上层业务不关心底层到底是 OpenAI、Claude 还是 Ollama，只关心“我要一个总结结果”。

#### 更强的权限与审计能力

例如只有具备特定权限的用户才能触发高成本模型调用：

```php
public function generateAnalysis(Request $request, Report $report, LlmManager $llm)
{
    $this->authorize('generateAiAnalysis', $report);

    $result = $llm->driver('openai')->chat([
        ['role' => 'system', 'content' => '你是企业级 BI 分析助手'],
        ['role' => 'user', 'content' => $report->raw_content],
    ]);

    return response()->json($result);
}
```

#### 更好的成本控制

你可以在后端集中统计每个租户、每个功能、每个模型的 token 消耗，并做限流、熔断或模型降级。

#### 更容易与业务数据融合

比如生成销售复盘时，可以直接在后端拉取 CRM、订单、客服记录与知识库摘要，把上下文组织后再交给模型处理。

### 1.4 一个更接近真实生产的架构建议

在生产里，我通常建议把 LLM 能力拆成四层：

```php
App\AI\
├── Contracts/
│   └── LlmClientInterface.php
├── DTOs/
│   ├── ChatRequest.php
│   └── ChatResponse.php
├── Drivers/
│   ├── OpenAiClient.php
│   ├── ClaudeClient.php
│   └── OllamaClient.php
├── Prompts/
│   └── PromptRenderer.php
├── Billing/
│   └── TokenUsageRecorder.php
└── LlmManager.php
```

分层职责大致如下：

- **Driver 层**：只负责和具体模型通信；
- **Manager 层**：负责根据配置选择驱动；
- **Prompt 层**：负责模板渲染和变量注入；
- **Billing 层**：负责记录 token 与成本；
- **业务 Service 层**：面向场景，如“生成商品卖点”“总结工单”“提取合同字段”。

这套结构的关键价值在于：模型接入只是基础，真正需要长期维护的是“围绕模型的工程系统”。

---

## 二、主流 LLM API 对接：OpenAI / Claude / 本地 Ollama

很多文章介绍模型接入时，只会写 `Http::post()`，但真正到生产阶段，最大的挑战不是“怎么调通”，而是“怎么统一抽象”。因为不同厂商在 API 路径、消息格式、流式协议、错误结构和 token 统计上都存在差异。

这一节我们用 Laravel 封装三个典型来源：

1. **OpenAI**：生态成熟，通用能力强；
2. **Claude**：长上下文与文本任务体验稳定；
3. **Ollama**：本地模型部署灵活，适合隐私数据或低成本场景。

### 2.1 先定义统一契约

不要一上来就写三个 Client。先写统一接口。

```php
<?php

namespace App\AI\Contracts;

use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;

interface LlmClientInterface
{
    public function chat(ChatRequest $request): ChatResponse;

    public function stream(ChatRequest $request, callable $onChunk): void;
}
```

请求与响应也建议做 DTO：

```php
<?php

namespace App\AI\DTOs;

class ChatRequest
{
    public function __construct(
        public readonly array $messages,
        public readonly string $model,
        public readonly float $temperature = 0.7,
        public readonly ?int $maxTokens = null,
        public readonly array $metadata = [],
    ) {}

    public function toArray(): array
    {
        return [
            'messages' => $this->messages,
            'model' => $this->model,
            'temperature' => $this->temperature,
            'max_tokens' => $this->maxTokens,
            'metadata' => $this->metadata,
        ];
    }
}
```

```php
<?php

namespace App\AI\DTOs;

class ChatResponse
{
    public function __construct(
        public readonly string $content,
        public readonly string $model,
        public readonly array $usage = [],
        public readonly array $raw = [],
        public readonly ?string $finishReason = null,
    ) {}
}
```

这样做的深层意义是：上层业务不再依赖某家厂商的原始 JSON 结构。

### 2.2 OpenAI 对接

先在 `config/services.php` 增加配置：

```php
'openai' => [
    'key' => env('OPENAI_API_KEY'),
    'base_url' => env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    'model' => env('OPENAI_MODEL', 'gpt-4.1-mini'),
],
```

`.env` 中：

```env
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4.1-mini
```

实现驱动：

```php
<?php

namespace App\AI\Drivers;

use App\AI\Contracts\LlmClientInterface;
use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

class OpenAiClient implements LlmClientInterface
{
    public function __construct(private HttpFactory $http) {}

    public function chat(ChatRequest $request): ChatResponse
    {
        $response = $this->http->baseUrl(config('services.openai.base_url'))
            ->withToken(config('services.openai.key'))
            ->timeout(60)
            ->post('/chat/completions', [
                'model' => $request->model,
                'messages' => $request->messages,
                'temperature' => $request->temperature,
                'max_tokens' => $request->maxTokens,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('OpenAI request failed: '.$response->body());
        }

        $data = $response->json();

        return new ChatResponse(
            content: data_get($data, 'choices.0.message.content', ''),
            model: data_get($data, 'model', $request->model),
            usage: data_get($data, 'usage', []),
            raw: $data,
            finishReason: data_get($data, 'choices.0.finish_reason'),
        );
    }

    public function stream(ChatRequest $request, callable $onChunk): void
    {
        throw new RuntimeException('OpenAI stream example will be implemented in streaming section.');
    }
}
```

#### 深度分析：为什么不要直接把原始响应往外透传

许多项目初期为了省事，直接返回 `choices[0].message.content`。这很快会带来三个问题：

1. 无法追踪 token 使用；
2. 无法分析 finish reason；
3. 上层对 OpenAI JSON 结构产生耦合。

所以我更建议在驱动层就把这些字段规范化，至少保留：

- `content`
- `model`
- `usage`
- `finishReason`
- `raw`

### 2.2.1 不同 LLM Provider 集成方式对比

当项目进入生产阶段后，真正影响维护成本的，往往不是“能不能调通”，而是你选择了哪种接入方式。下面这张表可以帮助 Laravel / PHP 团队更快判断：

| 集成方式 | 代表 Provider / 方案 | Laravel 接入复杂度 | 优势 | 局限 | 适合场景 |
| --- | --- | --- | --- | --- | --- |
| 官方云 API 直连 | OpenAI、Anthropic Claude | 低 | 文档成熟、模型更新快、能力稳定、适合快速上线 | 成本受 token 波动影响，外网依赖强，敏感数据合规要求更高 | 通用问答、内容生成、运营辅助、MVP 验证 |
| 统一适配层封装 | 在 Laravel 中自建 `LlmManager` + Driver | 中 | 屏蔽不同 API 差异，便于切换模型、做计费审计、降级与灰度发布 | 前期抽象设计需要投入，接口定义不当会造成二次返工 | 多模型并存、企业内部 AI 网关、长期演进项目 |
| 第三方 AI 平台代理 | Azure OpenAI、OpenRouter、企业 AI Gateway | 中 | 统一鉴权、可加治理能力、便于配额控制和区域合规 | 平台层会引入额外延迟，供应商能力不一定完全一致 | 企业合规、统一采购、需要路由与配额管理 |
| 本地模型服务 | Ollama、自建 vLLM / LM Studio | 中高 | 数据不出内网、边际成本低、可定制部署策略 | 需要自行处理算力、模型更新、监控和容量规划 | 敏感数据处理、内网知识库、成本敏感型任务 |
| 混合路由模式 | 云模型 + 本地模型 + 降级策略 | 高 | 能兼顾效果、成本、可用性与合规，适合按场景选模型 | 路由、回退、计费、评测链路都会更复杂 | 成熟 AI 应用、分级服务、对 SLA 和预算都敏感的系统 |

如果你是第一次在 Laravel 中引入 LLM，我建议默认从“**官方云 API + 自建统一适配层**”开始：先保证能力上线速度，再逐步补上计费、路由、缓存与降级。这样通常比一开始就押注单一 Provider 或直接自建本地集群更稳。

### 2.3 Claude 对接

Anthropic 的接口结构与 OpenAI 不一样，头部也不同。

配置：

```php
'anthropic' => [
    'key' => env('ANTHROPIC_API_KEY'),
    'base_url' => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1'),
    'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-4-0'),
    'version' => env('ANTHROPIC_VERSION', '2023-06-01'),
],
```

驱动实现：

```php
<?php

namespace App\AI\Drivers;

use App\AI\Contracts\LlmClientInterface;
use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

class ClaudeClient implements LlmClientInterface
{
    public function __construct(private HttpFactory $http) {}

    public function chat(ChatRequest $request): ChatResponse
    {
        $response = $this->http->baseUrl(config('services.anthropic.base_url'))
            ->withHeaders([
                'x-api-key' => config('services.anthropic.key'),
                'anthropic-version' => config('services.anthropic.version'),
                'content-type' => 'application/json',
            ])
            ->timeout(60)
            ->post('/messages', [
                'model' => $request->model,
                'max_tokens' => $request->maxTokens ?? 1024,
                'temperature' => $request->temperature,
                'messages' => $request->messages,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Claude request failed: '.$response->body());
        }

        $data = $response->json();
        $textBlocks = collect(data_get($data, 'content', []))
            ->where('type', 'text')
            ->pluck('text')
            ->implode("\n");

        return new ChatResponse(
            content: $textBlocks,
            model: data_get($data, 'model', $request->model),
            usage: data_get($data, 'usage', []),
            raw: $data,
            finishReason: data_get($data, 'stop_reason'),
        );
    }

    public function stream(ChatRequest $request, callable $onChunk): void
    {
        throw new RuntimeException('Claude stream example will be implemented in streaming section.');
    }
}
```

#### 深度分析：Claude 和 OpenAI 的抽象差异

最大差异点主要在：

- Claude 的内容是 `content` 数组，不是单一 `message.content`；
- 鉴权头不是 Bearer Token；
- `max_tokens` 在 Claude 中几乎是必填思维方式；
- 停止原因字段名字不同。

因此，统一契约的价值在这里就非常明显：上层业务只消费 `ChatResponse`，不再知道底层厂商差异。

### 2.4 本地 Ollama 对接

如果你需要处理企业私有数据、或者对成本非常敏感，本地模型是很现实的路线。Ollama 在本地启动后，一般监听 `http://localhost:11434`。

配置：

```php
'ollama' => [
    'base_url' => env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/api'),
    'model' => env('OLLAMA_MODEL', 'qwen2.5:7b'),
],
```

驱动：

```php
<?php

namespace App\AI\Drivers;

use App\AI\Contracts\LlmClientInterface;
use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

class OllamaClient implements LlmClientInterface
{
    public function __construct(private HttpFactory $http) {}

    public function chat(ChatRequest $request): ChatResponse
    {
        $response = $this->http->baseUrl(config('services.ollama.base_url'))
            ->timeout(300)
            ->post('/chat', [
                'model' => $request->model,
                'messages' => $request->messages,
                'stream' => false,
                'options' => [
                    'temperature' => $request->temperature,
                ],
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Ollama request failed: '.$response->body());
        }

        $data = $response->json();

        return new ChatResponse(
            content: data_get($data, 'message.content', ''),
            model: data_get($data, 'model', $request->model),
            usage: [
                'prompt_tokens' => data_get($data, 'prompt_eval_count'),
                'completion_tokens' => data_get($data, 'eval_count'),
            ],
            raw: $data,
            finishReason: data_get($data, 'done_reason'),
        );
    }

    public function stream(ChatRequest $request, callable $onChunk): void
    {
        throw new RuntimeException('Ollama stream example will be implemented in streaming section.');
    }
}
```

#### 深度分析：本地模型不是“免费午餐”

很多团队第一次接触 Ollama 时，会把它理解为“省钱版本 OpenAI”。这个理解只对一半。

本地模型的真实成本包括：

- 部署与运维机器成本；
- 模型加载时间和内存占用；
- 推理速度不稳定；
- 输出质量需要通过 Prompt 或模型选择弥补；
- 多并发场景下吞吐压力明显。

但它的优势也同样强：

- 数据不出内网；
- 适合离线处理；
- 成本可控；
- 方便做私有知识场景原型。

### 2.5 统一管理多模型路由

我们可以写一个 `LlmManager`：

```php
<?php

namespace App\AI;

use App\AI\Contracts\LlmClientInterface;
use InvalidArgumentException;

class LlmManager
{
    public function __construct(private array $drivers) {}

    public function driver(?string $name = null): LlmClientInterface
    {
        $name ??= config('ai.default_driver', 'openai');

        if (! isset($this->drivers[$name])) {
            throw new InvalidArgumentException("LLM driver [{$name}] not supported.");
        }

        return $this->drivers[$name];
    }
}
```

业务层调用：

```php
$result = $llmManager->driver('claude')->chat(new ChatRequest(
    messages: [
        ['role' => 'system', 'content' => '你是一名资深客服质检分析师'],
        ['role' => 'user', 'content' => $conversationText],
    ],
    model: config('services.anthropic.model'),
    temperature: 0.2,
    maxTokens: 1200,
));
```

这时候，上层已经从“调用某个 API”升级为“调用一个可替换的 AI 能力提供者”。

---

## 三、Laravel Service Provider 封装

如果你只是写几个 Client 类，然后在 Controller 里 `new OpenAiClient()`，那说明你只完成了“能运行”，还没有完成“工程化”。

在 Laravel 里，正确姿势是通过 Service Provider 把驱动、配置、默认路由和扩展点注册进容器。这样你才能做到：

- 随环境切换模型供应商；
- 在测试时替换实现；
- 面向接口编程；
- 让所有业务 Service 用统一入口访问 AI 能力。

### 3.1 创建配置文件

先新建 `config/ai.php`：

```php
<?php

return [
    'default_driver' => env('LLM_DRIVER', 'openai'),

    'drivers' => [
        'openai' => [
            'model' => env('OPENAI_MODEL', 'gpt-4.1-mini'),
        ],
        'claude' => [
            'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-4-0'),
        ],
        'ollama' => [
            'model' => env('OLLAMA_MODEL', 'qwen2.5:7b'),
        ],
    ],
];
```

### 3.2 编写 Service Provider

```php
<?php

namespace App\Providers;

use App\AI\Drivers\ClaudeClient;
use App\AI\Drivers\OllamaClient;
use App\AI\Drivers\OpenAiClient;
use App\AI\LlmManager;
use Illuminate\Support\ServiceProvider;

class AiServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(OpenAiClient::class, fn ($app) => new OpenAiClient($app['http']));
        $this->app->singleton(ClaudeClient::class, fn ($app) => new ClaudeClient($app['http']));
        $this->app->singleton(OllamaClient::class, fn ($app) => new OllamaClient($app['http']));

        $this->app->singleton(LlmManager::class, function ($app) {
            return new LlmManager([
                'openai' => $app->make(OpenAiClient::class),
                'claude' => $app->make(ClaudeClient::class),
                'ollama' => $app->make(OllamaClient::class),
            ]);
        });
    }

    public function boot(): void
    {
        // 可在这里注册宏、事件监听、发布配置等
    }
}
```

然后在 `config/app.php` 注册 Provider，或者如果你是 Laravel 新版本，也可以通过自动发现或 bootstrap 配置接入。

### 3.3 面向业务再包装一层 AI Service

实际项目里，不建议 Controller 直接拼 Prompt。更合理的方式是业务服务层二次封装。

```php
<?php

namespace App\Services;

use App\AI\DTOs\ChatRequest;
use App\AI\LlmManager;

class TicketAnalysisService
{
    public function __construct(private LlmManager $llmManager) {}

    public function analyze(string $ticketText): array
    {
        $response = $this->llmManager->driver('openai')->chat(new ChatRequest(
            messages: [
                ['role' => 'system', 'content' => '你是售后工单分类助手，请返回 JSON'],
                ['role' => 'user', 'content' => $ticketText],
            ],
            model: config('ai.drivers.openai.model'),
            temperature: 0.1,
            maxTokens: 800,
        ));

        return json_decode($response->content, true, 512, JSON_THROW_ON_ERROR);
    }
}
```

#### 深度分析：为什么要再加一层业务 Service

因为大部分团队最容易失控的地方不是 API 对接，而是 Prompt 四处散落在 Controller、Job、Command、Listener 里。一旦场景多了，维护非常痛苦。

把场景沉淀为业务 Service，有几个明显好处：

- Prompt 与业务语义绑定；
- 更方便做单元测试；
- 更容易迁移模型；
- 便于做缓存、计费、审计；
- Controller 只负责输入输出，不承担 AI 细节。

### 3.4 在测试环境替换为 Fake 实现

这是 Laravel 容器的真正威力之一。

```php
<?php

namespace Tests\Fakes;

use App\AI\Contracts\LlmClientInterface;
use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;

class FakeLlmClient implements LlmClientInterface
{
    public function chat(ChatRequest $request): ChatResponse
    {
        return new ChatResponse(
            content: '{"category":"billing","priority":"medium"}',
            model: 'fake-model',
            usage: ['prompt_tokens' => 10, 'completion_tokens' => 20],
            raw: [],
            finishReason: 'stop',
        );
    }

    public function stream(ChatRequest $request, callable $onChunk): void
    {
        $onChunk('{"chunk":"hello"}');
    }
}
```

测试中替换绑定：

```php
public function test_ticket_analysis_can_be_generated(): void
{
    $this->app->bind(\App\AI\Drivers\OpenAiClient::class, \Tests\Fakes\FakeLlmClient::class);

    $service = $this->app->make(\App\Services\TicketAnalysisService::class);
    $result = $service->analyze('客户说重复扣费');

    $this->assertSame('billing', $result['category']);
}
```

这在 AI 集成里非常关键，因为真实调用外部模型既慢又贵，不适合作为常规测试依赖。

---

## 四、Streaming 响应处理

流式输出是 AI 产品体验里非常重要的一环。尤其当生成内容较长、模型响应时间不可忽略时，Streaming 能显著改善用户体感。对于 Laravel 来说，这一节的难点不在于“怎么读 chunk”，而在于：

- 如何和不同供应商的流协议对齐；
- 如何把 chunk 持续推给前端；
- 如何避免 PHP/FPM/Nginx 缓冲导致“假流式”；
- 如何在中途中断、统计和记录结果。

### 4.1 Laravel 中返回流式响应

Laravel 可以用 `response()->stream()`：

```php
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AiStreamController
{
    public function __invoke(Request $request, \App\AI\LlmManager $llmManager): StreamedResponse
    {
        return response()->stream(function () use ($request, $llmManager) {
            $chatRequest = new \App\AI\DTOs\ChatRequest(
                messages: [
                    ['role' => 'system', 'content' => '你是技术写作助手'],
                    ['role' => 'user', 'content' => $request->input('prompt')],
                ],
                model: config('ai.drivers.openai.model'),
                temperature: 0.5,
                maxTokens: 1200,
            );

            $llmManager->driver('openai')->stream($chatRequest, function (string $chunk) {
                echo "data: ".json_encode(['content' => $chunk], JSON_UNESCAPED_UNICODE)."\n\n";
                @ob_flush();
                flush();
            });

            echo "data: [DONE]\n\n";
            @ob_flush();
            flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
```

这里使用的是 SSE（Server-Sent Events）格式，前端可以直接 `EventSource` 或 fetch 流式消费。

### 4.2 OpenAI Streaming 实现示例

Laravel 自带 HTTP Client 对流式细粒度控制有限，很多时候我会在流式场景下用底层 Guzzle 或原生 stream 处理。这里给一个 Guzzle 风格示例：

```php
<?php

namespace App\AI\Drivers;

use App\AI\Contracts\LlmClientInterface;
use App\AI\DTOs\ChatRequest;
use App\AI\DTOs\ChatResponse;
use GuzzleHttp\Client;
use RuntimeException;

class OpenAiClient implements LlmClientInterface
{
    public function __construct(private \Illuminate\Http\Client\Factory $http) {}

    public function chat(ChatRequest $request): ChatResponse
    {
        // 省略，同前文
    }

    public function stream(ChatRequest $request, callable $onChunk): void
    {
        $client = new Client([
            'base_uri' => config('services.openai.base_url'),
            'timeout' => 0,
        ]);

        $response = $client->post('/chat/completions', [
            'headers' => [
                'Authorization' => 'Bearer '.config('services.openai.key'),
                'Content-Type' => 'application/json',
            ],
            'json' => [
                'model' => $request->model,
                'messages' => $request->messages,
                'temperature' => $request->temperature,
                'max_tokens' => $request->maxTokens,
                'stream' => true,
            ],
            'stream' => true,
        ]);

        $body = $response->getBody();
        $buffer = '';

        while (! $body->eof()) {
            $buffer .= $body->read(1024);

            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $pos));
                $buffer = substr($buffer, $pos + 1);

                if ($line === '' || ! str_starts_with($line, 'data: ')) {
                    continue;
                }

                $payload = substr($line, 6);

                if ($payload === '[DONE]') {
                    return;
                }

                $json = json_decode($payload, true);
                $content = data_get($json, 'choices.0.delta.content');

                if ($content) {
                    $onChunk($content);
                }
            }
        }
    }
}
```

#### 深度分析：为什么看起来“流式”，结果前端还是最后一次性收到

这是极其常见的坑，通常不是模型没流式，而是中间链路被缓冲了：

- PHP output buffering 未关闭；
- Nginx 默认缓冲；
- 某些 CDN 或反向代理缓冲响应；
- 前端消费方式不对；
- Laravel Octane / Swoole 与 FPM 的行为差异。

所以你会看到我上面的响应头中加入了：

```php
'X-Accel-Buffering' => 'no'
```

同时每次 chunk 后都执行：

```php
@ob_flush();
flush();
```

这不是“玄学代码”，而是流式体验能否真实落地的关键。

### 4.3 Claude 与 Ollama 的流式处理差异

Claude 的 SSE 事件类型会更多，例如 message_start、content_block_delta、message_delta 等，因此你不能像 OpenAI 一样只盯着一个字段。通常需要针对事件类型解析。

伪代码如下：

```php
if (($json['type'] ?? null) === 'content_block_delta') {
    $text = data_get($json, 'delta.text');
    if ($text) {
        $onChunk($text);
    }
}
```

而 Ollama 的流式返回通常是逐行 JSON：

```php
while (! $body->eof()) {
    $line = trim($body->read(1024));
    if ($line === '') {
        continue;
    }

    $json = json_decode($line, true);
    $content = data_get($json, 'message.content');

    if ($content) {
        $onChunk($content);
    }

    if (data_get($json, 'done') === true) {
        break;
    }
}
```

#### 核心结论

**不要试图用一套解析逻辑兼容所有厂商的流响应。** 正确做法是在驱动层各自处理，再向上层统一输出文本 chunk。

### 4.4 前端消费示例

虽然本文重点是 Laravel 后端，但后端流式是否成功，前端也得配合。最简单的浏览器消费例子：

```javascript
const eventSource = new EventSource('/api/ai/stream?prompt=' + encodeURIComponent('写一个 Laravel 队列说明'));

let content = '';

eventSource.onmessage = (event) => {
  if (event.data === '[DONE]') {
    eventSource.close();
    return;
  }

  const payload = JSON.parse(event.data);
  content += payload.content;
  document.querySelector('#output').textContent = content;
};
```

### 4.5 流式场景下的日志与落库

流式返回还有一个常见问题：如果用户中途断开连接，结果是否还要继续生成？是否要落库存档？

在生产中我通常建议：

- 对强交互场景，用户断开则终止生成；
- 对内容生产场景，流式只用于展示，后台仍完整保存结果；
- 累积 chunk 时使用字符串缓冲，结束后统一写库。

```php
$fullContent = '';

$driver->stream($chatRequest, function (string $chunk) use (&$fullContent) {
    $fullContent .= $chunk;

    echo "data: ".json_encode(['content' => $chunk], JSON_UNESCAPED_UNICODE)."\n\n";
    @ob_flush();
    flush();
});

AiMessage::create([
    'prompt' => $prompt,
    'response' => $fullContent,
]);
```

如果不这样做，你很可能在审计、计费和故障排查时失去完整上下文。

### 4.6 一个更实用的 Laravel Streaming 落地示例

如果你准备把 Streaming 真正用于业务接口，我更建议在 Controller 里把“客户端断开检测、缓冲累积、结束后落库、异常日志”一次性处理完整，而不是只演示 `echo + flush()`。下面这个例子更接近生产：

```php
use App\AI\DTOs\ChatRequest;
use App\Models\AiConversation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

class StreamArticleSummaryController
{
    public function __invoke(Request $request, \App\AI\LlmManager $llmManager): StreamedResponse
    {
        $conversation = AiConversation::create([
            'scene' => 'article_summary_stream',
            'user_id' => $request->user()?->id,
            'prompt' => $request->string('prompt')->toString(),
            'status' => 'streaming',
        ]);

        return response()->stream(function () use ($request, $llmManager, $conversation) {
            $fullContent = '';

            try {
                $chatRequest = new ChatRequest(
                    messages: [
                        ['role' => 'system', 'content' => '你是 Laravel 后端 AI 助手，请输出结构清晰的总结。'],
                        ['role' => 'user', 'content' => $request->string('prompt')->toString()],
                    ],
                    model: config('ai.drivers.openai.model'),
                    temperature: 0.4,
                    maxTokens: 1500,
                    metadata: ['conversation_id' => $conversation->id],
                );

                $llmManager->driver('openai')->stream($chatRequest, function (string $chunk) use (&$fullContent) {
                    if (connection_aborted()) {
                        throw new \RuntimeException('Client disconnected during stream');
                    }

                    $fullContent .= $chunk;

                    echo "event: token\n";
                    echo 'data: '.json_encode([
                        'content' => $chunk,
                        'length' => mb_strlen($fullContent),
                    ], JSON_UNESCAPED_UNICODE)."\n\n";

                    @ob_flush();
                    flush();
                });

                $conversation->update([
                    'response' => $fullContent,
                    'status' => 'completed',
                ]);

                echo "event: done\n";
                echo "data: [DONE]\n\n";
            } catch (\Throwable $e) {
                Log::warning('AI stream interrupted', [
                    'conversation_id' => $conversation->id,
                    'message' => $e->getMessage(),
                ]);

                $conversation->update([
                    'response' => $fullContent,
                    'status' => 'failed',
                    'error_message' => $e->getMessage(),
                ]);

                echo "event: error\n";
                echo 'data: '.json_encode([
                    'message' => 'stream interrupted',
                ], JSON_UNESCAPED_UNICODE)."\n\n";
            }

            @ob_flush();
            flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
```

这个版本比最基础示例更有价值，主要体现在四点：

1. **开始流式前先创建会话记录**，便于后续审计、断线恢复和成本统计；
2. **持续累积 `fullContent`**，避免只有前端看到了内容、后端却没有完整结果；
3. **检测 `connection_aborted()`**，在用户关闭页面时及时中断，减少无效 token 消耗；
4. **区分 completed / failed 状态**，便于后续排查是模型报错、代理缓冲还是客户端提前断开。

如果你的 Laravel 应用部署在 Nginx + PHP-FPM 之后，这类“完整生命周期处理”通常比单纯解析供应商 SSE 更重要，因为多数线上问题都出在链路缓冲、连接中断和落库不完整。

---

## 五、Token 计费与成本控制

很多 AI 功能上线失败，不是因为效果不行，而是因为成本失控。模型调用最大的误区之一，就是“先跑起来再说”。等到月账单出来，才发现一个看似简单的摘要功能每天要烧掉数百美元。

Laravel 后端集成 LLM 时，成本控制必须从第一天就设计进去。

### 5.1 至少记录哪些字段

我建议每次调用至少记录以下数据：

- 租户 ID / 用户 ID
- 业务场景，如 `ticket_analysis`
- 模型供应商
- 模型名称
- prompt tokens
- completion tokens
- 总 token
- 估算成本
- 请求耗时
- 请求状态
- trace id

比如建一张 `ai_usages` 表：

```php
Schema::create('ai_usages', function (Blueprint $table) {
    $table->id();
    $table->string('scene');
    $table->nullableMorphs('owner');
    $table->string('provider');
    $table->string('model');
    $table->unsignedInteger('prompt_tokens')->default(0);
    $table->unsignedInteger('completion_tokens')->default(0);
    $table->unsignedInteger('total_tokens')->default(0);
    $table->decimal('estimated_cost', 12, 6)->default(0);
    $table->unsignedInteger('latency_ms')->default(0);
    $table->string('status')->default('success');
    $table->string('trace_id')->nullable();
    $table->timestamps();
});
```

### 5.2 计费器封装

```php
<?php

namespace App\AI\Billing;

use App\Models\AiUsage;

class TokenUsageRecorder
{
    public function record(array $payload): AiUsage
    {
        return AiUsage::create([
            'scene' => $payload['scene'],
            'owner_type' => $payload['owner_type'] ?? null,
            'owner_id' => $payload['owner_id'] ?? null,
            'provider' => $payload['provider'],
            'model' => $payload['model'],
            'prompt_tokens' => $payload['prompt_tokens'] ?? 0,
            'completion_tokens' => $payload['completion_tokens'] ?? 0,
            'total_tokens' => ($payload['prompt_tokens'] ?? 0) + ($payload['completion_tokens'] ?? 0),
            'estimated_cost' => $payload['estimated_cost'] ?? 0,
            'latency_ms' => $payload['latency_ms'] ?? 0,
            'status' => $payload['status'] ?? 'success',
            'trace_id' => $payload['trace_id'] ?? null,
        ]);
    }
}
```

### 5.3 不同模型单价管理

把价格硬编码在业务逻辑中是灾难，建议集中配置：

```php
return [
    'pricing' => [
        'gpt-4.1-mini' => [
            'input' => 0.40,
            'output' => 1.60,
        ],
        'claude-sonnet-4-0' => [
            'input' => 3.00,
            'output' => 15.00,
        ],
        'qwen2.5:7b' => [
            'input' => 0,
            'output' => 0,
        ],
    ],
];
```

这里的单位可以统一按“每百万 token 价格”。计算时：

```php
<?php

namespace App\AI\Billing;

class CostCalculator
{
    public function estimate(string $model, int $promptTokens, int $completionTokens): float
    {
        $pricing = config("ai.pricing.{$model}");

        if (! $pricing) {
            return 0.0;
        }

        $inputCost = ($promptTokens / 1_000_000) * $pricing['input'];
        $outputCost = ($completionTokens / 1_000_000) * $pricing['output'];

        return round($inputCost + $outputCost, 6);
    }
}
```

### 5.4 预算与限流

成本控制不能只做“事后记录”，还要做“事前限制”。

比如一个租户每天预算 20 美元，超过就自动降级模型：

```php
class BudgetGuard
{
    public function shouldDowngrade(int $tenantId): bool
    {
        $todayCost = \App\Models\AiUsage::query()
            ->where('owner_type', 'tenant')
            ->where('owner_id', $tenantId)
            ->whereDate('created_at', now()->toDateString())
            ->sum('estimated_cost');

        return $todayCost >= 20;
    }
}
```

然后在调用前路由：

```php
$model = $budgetGuard->shouldDowngrade($tenantId)
    ? 'gpt-4.1-mini'
    : 'claude-sonnet-4-0';
```

#### 深度分析：真正省钱的不是“换便宜模型”，而是缩短上下文

很多团队一开始想到的成本控制方式是换更便宜的模型，但真实项目里更有效的往往是：

- 缩短系统提示词；
- 只传必要上下文；
- 对历史对话做摘要，而不是原样拼接；
- 对重复请求启用缓存；
- 分类任务用小模型，复杂生成才用大模型；
- 限制 `max_tokens`。

比如下面这个反例就很常见：

```php
$messages = [
    ['role' => 'system', 'content' => file_get_contents(resource_path('prompts/huge_system_prompt.txt'))],
    ['role' => 'user', 'content' => json_encode($entireUserProfileAndLogs)],
];
```

这类写法通常会让成本和延迟同步飙升。

### 5.5 结果缓存

对于“相同输入 -> 相同输出容忍度高”的场景，可以直接缓存结果。

```php
use Illuminate\Support\Facades\Cache;

$key = 'ai:summary:'.md5($articleContent);

$result = Cache::remember($key, now()->addHours(6), function () use ($service, $articleContent) {
    return $service->summarize($articleContent);
});
```

不是所有 AI 场景都适合缓存，但摘要、标签生成、结构化提取这类 deterministic 场景收益非常明显。

---

## 六、Prompt 模板管理

如果说模型调用是发动机，那么 Prompt 就是驾驶策略。很多 Laravel 项目在这一层最容易迅速变脏：Prompt 直接拼在 Controller 字符串里，变量替换全靠插值，版本不可追踪，线上调整靠搜索全项目替换。

这在小项目阶段还能忍，到生产阶段就会变成维护灾难。

### 6.1 为什么 Prompt 要模板化

模板化管理 Prompt 的价值主要在于：

- 可复用；
- 可版本化；
- 可测试；
- 可与业务语义绑定；
- 可逐步演化，而不是散落在代码里。

### 6.2 最简单的文件模板方案

你可以先从 `resources/prompts` 开始：

```text
resources/prompts/
├── ticket-analysis.system.txt
├── article-summary.system.txt
└── sales-report.user.txt
```

例如 `resources/prompts/ticket-analysis.system.txt`：

```txt
你是一名企业售后工单分析助手。
你的目标是：
1. 判断工单类别
2. 判断优先级
3. 输出 JSON，格式为：
{"category":"","priority":"","reason":""}
不要输出 Markdown，不要输出额外解释。
```

然后写一个渲染器：

```php
<?php

namespace App\AI\Prompts;

use Illuminate\Support\Facades\File;
use RuntimeException;

class PromptRenderer
{
    public function render(string $name, array $variables = []): string
    {
        $path = resource_path("prompts/{$name}.txt");

        if (! File::exists($path)) {
            throw new RuntimeException("Prompt template [{$name}] not found.");
        }

        $content = File::get($path);

        foreach ($variables as $key => $value) {
            $content = str_replace('{{'.$key.'}}', (string) $value, $content);
        }

        return $content;
    }
}
```

模板示例 `resources/prompts/sales-report.user.txt`：

```txt
请根据以下销售数据生成日报总结：
日期：{{date}}
销售额：{{sales_amount}}
新增客户数：{{new_customers}}
退单数：{{refund_count}}
请输出三部分：总体结论、风险点、明日建议。
```

调用：

```php
$systemPrompt = $promptRenderer->render('ticket-analysis.system');
$userPrompt = $promptRenderer->render('sales-report.user', [
    'date' => now()->toDateString(),
    'sales_amount' => 128000,
    'new_customers' => 43,
    'refund_count' => 2,
]);
```

### 6.3 Prompt 不只是字符串模板，还应该有元信息

到了生产阶段，我通常建议 Prompt 除正文外，再附加元信息，例如：

- 模板名
- 版本号
- 适用场景
- 推荐模型
- temperature 建议
- 最大 token 建议
- 输出格式要求

你可以定义一个 Prompt 对象：

```php
class PromptDefinition
{
    public function __construct(
        public readonly string $name,
        public readonly string $system,
        public readonly ?string $userTemplate,
        public readonly string $version,
        public readonly string $recommendedModel,
        public readonly float $temperature = 0.2,
        public readonly ?int $maxTokens = 1000,
    ) {}
}
```

这样业务层就可以围绕 PromptDefinition 构造请求，而不是每次手写参数。

### 6.4 数据库存 Prompt：适合运营可调场景

当产品经理、运营或算法同学需要频繁调整 Prompt 时，把模板完全写死在文件里就不够用了。此时可以考虑数据库表：

```php
Schema::create('prompt_templates', function (Blueprint $table) {
    $table->id();
    $table->string('name')->unique();
    $table->string('version');
    $table->text('system_prompt');
    $table->longText('user_prompt_template')->nullable();
    $table->string('model')->nullable();
    $table->decimal('temperature', 3, 2)->default(0.2);
    $table->unsignedInteger('max_tokens')->nullable();
    $table->boolean('is_active')->default(true);
    $table->timestamps();
});
```

查询与渲染：

```php
$template = PromptTemplate::query()
    ->where('name', 'ticket-analysis')
    ->where('is_active', true)
    ->latest('id')
    ->firstOrFail();

$userPrompt = str($template->user_prompt_template)
    ->replace('{{ticket_text}}', $ticketText)
    ->toString();
```

#### 深度分析：文件模板和数据库模板怎么选

我的经验是：

- **核心稳定场景**：优先文件模板，配合 Git 管理，变更可审计；
- **高频运营调优场景**：数据库模板更灵活；
- **大团队协作**：往往采用“双层结构”，基础模板在代码里，少量可调参数在数据库里。

### 6.5 Prompt 测试非常必要

Prompt 不是“玄学文案”，它应该被测试。

最简单的测试至少校验渲染完整性：

```php
public function test_sales_report_prompt_can_render(): void
{
    $renderer = app(\App\AI\Prompts\PromptRenderer::class);

    $content = $renderer->render('sales-report.user', [
        'date' => '2026-06-01',
        'sales_amount' => 1000,
        'new_customers' => 10,
        'refund_count' => 1,
    ]);

    $this->assertStringNotContainsString('{{date}}', $content);
    $this->assertStringContainsString('2026-06-01', $content);
}
```

更进一步，你可以做输出结构校验，保证模型返回 JSON 时字段完整。

---

## 七、错误处理与降级

如果你真的在线上跑过 LLM，就会知道失败不是偶发现象，而是常态之一。失败可能来自：

- 超时；
- 429 限流；
- 5xx 上游故障；
- 模型临时不可用；
- 流式连接中断；
- 输出不是合法 JSON；
- 本地模型 OOM；
- Prompt 触发安全拦截。

所以，AI 系统绝不能只写“Happy Path”。

### 7.1 分层处理异常

建议先定义领域异常：

```php
<?php

namespace App\AI\Exceptions;

use RuntimeException;

class LlmException extends RuntimeException {}
class LlmTimeoutException extends LlmException {}
class LlmRateLimitException extends LlmException {}
class LlmResponseFormatException extends LlmException {}
```

然后在驱动中把 HTTP 错误归类：

```php
if ($response->status() === 429) {
    throw new LlmRateLimitException('OpenAI rate limit exceeded.');
}

if ($response->status() >= 500) {
    throw new LlmException('LLM upstream server error: '.$response->body());
}
```

### 7.2 使用 Laravel HTTP Client 重试

```php
$response = Http::withToken(config('services.openai.key'))
    ->timeout(30)
    ->retry(3, 1000, function ($exception, $request) {
        return $exception instanceof \Illuminate\Http\Client\ConnectionException;
    })
    ->post('https://api.openai.com/v1/chat/completions', $payload);
```

但要注意：**不是所有错误都适合重试**。

适合重试的通常是：

- 网络抖动；
- 短暂 5xx；
- 可恢复的连接错误。

不适合盲目重试的包括：

- Prompt 格式错误；
- 401 鉴权失败；
- 明确的配额不足；
- 输出解析失败但根因是 Prompt 设计问题。

### 7.3 多级降级策略

生产环境常见降级顺序如下：

1. 首选高质量模型；
2. 超时或预算超限时切到轻量模型；
3. 再失败时返回缓存结果；
4. 再不行则返回规则引擎结果或人工提示。

示例：

```php
public function generateSummary(string $content): string
{
    try {
        return $this->llmManager->driver('claude')->chat(
            new ChatRequest(
                messages: [
                    ['role' => 'system', 'content' => '你是总结助手'],
                    ['role' => 'user', 'content' => $content],
                ],
                model: 'claude-sonnet-4-0',
                temperature: 0.3,
                maxTokens: 1200,
            )
        )->content;
    } catch (\Throwable $e) {
        report($e);
    }

    try {
        return $this->llmManager->driver('openai')->chat(
            new ChatRequest(
                messages: [
                    ['role' => 'system', 'content' => '你是总结助手'],
                    ['role' => 'user', 'content' => $content],
                ],
                model: 'gpt-4.1-mini',
                temperature: 0.3,
                maxTokens: 900,
            )
        )->content;
    } catch (\Throwable $e) {
        report($e);
    }

    return $this->ruleBasedSummary($content);
}
```

### 7.4 JSON 输出场景必须做二次校验

一个非常真实的坑：你明明在 Prompt 里写了“只返回 JSON”，模型还是会加解释、Markdown 代码块甚至尾注。

所以解析前先清洗，再校验：

```php
public function parseJsonResponse(string $content): array
{
    $clean = trim($content);
    $clean = preg_replace('/^```json\s*/', '', $clean);
    $clean = preg_replace('/\s*```$/', '', $clean);

    $decoded = json_decode($clean, true);

    if (! is_array($decoded)) {
        throw new \App\AI\Exceptions\LlmResponseFormatException('LLM did not return valid JSON.');
    }

    return $decoded;
}
```

再进一步，可以用 Laravel Validator 校验结构：

```php
$validator = validator($decoded, [
    'category' => ['required', 'string'],
    'priority' => ['required', 'string'],
    'reason' => ['required', 'string'],
]);

if ($validator->fails()) {
    throw new \App\AI\Exceptions\LlmResponseFormatException($validator->errors()->first());
}
```

这一步在结构化抽取、分类、标签场景里非常关键。

### 7.5 熔断与告警

如果某个供应商连续失败，不要每个请求都继续打上游。可以加入简单熔断。

```php
use Illuminate\Support\Facades\Cache;

class LlmCircuitBreaker
{
    public function isOpen(string $provider): bool
    {
        return Cache::get("ai:circuit:{$provider}", false) === true;
    }

    public function trip(string $provider, int $seconds = 60): void
    {
        Cache::put("ai:circuit:{$provider}", true, now()->addSeconds($seconds));
    }
}
```

一旦某供应商在 1 分钟内连续超时 10 次，就临时熔断，自动走备用模型。

#### 深度分析：错误处理的核心不是“别报错”，而是“报错后系统仍可用”

AI 场景最忌讳的是把模型调用当作确定性函数使用。你必须默认它会失败，然后围绕失败设计恢复路径。真正成熟的系统，不是从不出错，而是出错时用户体验仍然可接受。

---

## 八、队列异步调用

不是所有 AI 请求都适合 HTTP 同步返回。像文章生成、批量分类、知识清洗、合同抽取、客服质检、大批量标签生成这类任务，如果放在 Web 请求里同步处理，往往会造成：

- 请求超时；
- 用户长时间等待；
- PHP Worker 被占满；
- 失败后不易重试；
- 成本与吞吐不可控。

Laravel 队列在这里几乎是天然适配的。

### 8.1 一个典型异步流程

1. 用户提交任务；
2. 后端创建任务记录；
3. 投递 Job 到队列；
4. Worker 调用 LLM；
5. 写回结果与状态；
6. 前端轮询或 WebSocket 获取完成状态。

先建任务表：

```php
Schema::create('ai_tasks', function (Blueprint $table) {
    $table->id();
    $table->string('type');
    $table->string('status')->default('pending');
    $table->json('payload');
    $table->longText('result')->nullable();
    $table->text('error_message')->nullable();
    $table->timestamp('started_at')->nullable();
    $table->timestamp('finished_at')->nullable();
    $table->timestamps();
});
```

### 8.2 Job 实现示例

```php
<?php

namespace App\Jobs;

use App\AI\DTOs\ChatRequest;
use App\AI\LlmManager;
use App\Models\AiTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class GenerateArticleSummaryJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 180;

    public function __construct(public int $taskId) {}

    public function handle(LlmManager $llmManager): void
    {
        $task = AiTask::findOrFail($this->taskId);
        $task->update([
            'status' => 'processing',
            'started_at' => now(),
        ]);

        $payload = $task->payload;

        $response = $llmManager->driver('openai')->chat(new ChatRequest(
            messages: [
                ['role' => 'system', 'content' => '你是文章总结助手'],
                ['role' => 'user', 'content' => $payload['content']],
            ],
            model: config('ai.drivers.openai.model'),
            temperature: 0.3,
            maxTokens: 1200,
        ));

        $task->update([
            'status' => 'completed',
            'result' => $response->content,
            'finished_at' => now(),
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        AiTask::whereKey($this->taskId)->update([
            'status' => 'failed',
            'error_message' => $exception->getMessage(),
            'finished_at' => now(),
        ]);
    }
}
```

### 8.3 Controller 中投递任务

```php
public function createSummaryTask(Request $request)
{
    $task = \App\Models\AiTask::create([
        'type' => 'article_summary',
        'payload' => [
            'content' => $request->input('content'),
        ],
    ]);

    \App\Jobs\GenerateArticleSummaryJob::dispatch($task->id)->onQueue('ai');

    return response()->json([
        'task_id' => $task->id,
        'status' => $task->status,
    ]);
}
```

### 8.4 队列场景下的关键工程点

#### 幂等性

如果 Job 重试，是否会重复扣费、重复写结果？

可以通过任务状态判断避免重复执行：

```php
if ($task->status === 'completed') {
    return;
}
```

#### 超时设置

LLM 调用比普通 API 更容易超时，`$timeout` 和 HTTP Client `timeout()` 要一起协调。

#### 队列隔离

建议单独开 `ai` 队列，不要与支付、订单、通知混跑。

```bash
php artisan queue:work --queue=ai --tries=3 --timeout=300
```

#### 大批量任务要限速

如果你一口气 dispatch 10 万个 AI 任务，供应商侧很可能直接限流。应配合：

- Laravel Horizon 并发控制；
- 分批 dispatch；
- 每租户配额限制；
- 中间层速率控制。

### 8.5 批量处理与链式任务

有些任务可以拆分成多个阶段，比如：

1. 文档切片；
2. 每片摘要；
3. 聚合总结；
4. 落库；
5. 发送通知。

Laravel 的 `Bus::batch()` 与 `Bus::chain()` 在这里很好用。

```php
use Illuminate\Support\Facades\Bus;

Bus::chain([
    new SplitDocumentJob($documentId),
    new SummarizeChunksJob($documentId),
    new MergeSummaryJob($documentId),
])->dispatch();
```

#### 深度分析：队列不是“性能优化点”，而是 AI 任务的主运行方式

很多业务的 AI 调用天然是高延迟、低确定性、可重试的，这正是队列系统擅长处理的问题。因此在 Laravel 中，越接近生产，越应该把“同步调用”限定在少数强交互场景，把更多任务迁移到异步架构中。

---

## 九、真实踩坑记录

这一节我不讲“最佳实践口号”，只讲真实项目里非常容易踩到、而且往往是上线后才暴露的问题。

### 9.1 坑一：Prompt 要求输出 JSON，但模型经常包一层 Markdown 代码块

最开始我们写的是：

```php
['role' => 'system', 'content' => '请返回 JSON']
```

结果线上经常返回：

````text
```json
{"category":"refund"}
```
````

甚至还会附一句“以下是结果”。这会导致 `json_decode()` 直接失败。

#### 解决办法

- Prompt 中明确写“不要输出 Markdown 代码块”；
- 解析前做清洗；
- 用 Validator 校验字段；
- 失败后补一次修正型请求，要求模型只做格式修复。

例如修复器：

```php
public function repairJson(string $invalidContent): array
{
    $response = $this->llmManager->driver('openai')->chat(new ChatRequest(
        messages: [
            ['role' => 'system', 'content' => '你是 JSON 修复助手，只输出合法 JSON。'],
            ['role' => 'user', 'content' => $invalidContent],
        ],
        model: 'gpt-4.1-mini',
        temperature: 0,
        maxTokens: 600,
    ));

    return $this->parseJsonResponse($response->content);
}
```

### 9.2 坑二：本地 Ollama 在开发机很快，到了服务器突然变慢

开发机上你可能只自己调用一两个请求，看起来速度还行；上到服务器后，一旦并发稍高，推理速度和首 token 延迟会明显恶化。

#### 根因通常包括

- 模型尺寸过大，机器内存不够；
- CPU 推理吞吐太低；
- 模型频繁 cold start；
- 多任务并发把本地推理资源打满。

#### 解决方案

- 选择更小模型做分类/提取；
- 生产中把 Ollama 作为低优先级或离线任务模型；
- 对高并发在线接口仍优先云模型；
- 监控平均响应时间和队列堆积。

### 9.3 坑三：Streaming 本地正常，线上 Nginx 后全部变成一次性返回

这是我遇到最多次的问题之一。代码完全没变，但线上体验就是“最后一起吐出来”。

#### 典型原因

- Nginx 开了 proxy buffering；
- `fastcgi_buffering` 没关；
- CDN 缓冲；
- PHP-FPM 输出缓冲；
- 前端用了错误的请求方式。

#### 我们最后的处理方式

- 后端设置 `text/event-stream`；
- 加 `X-Accel-Buffering: no`；
- Nginx 关闭对应 location 的 buffering；
- chunk 后强制 `flush()`；
- 前端切换为 SSE 消费。

### 9.4 坑四：同样的 Prompt，在不同模型间迁移后效果大幅波动

很多团队以为抽象统一后，换模型只要改配置。实际上接口层能统一，不代表行为层能完全统一。

同一 Prompt 在 OpenAI、Claude、Ollama 上可能出现：

- 输出长度差异；
- 指令遵循程度不同；
- JSON 稳定性差异；
- 中文表达风格差异；
- 长上下文利用率差异。

#### 我的建议

- 不要幻想“一套 Prompt 通吃所有模型”；
- 关键场景给不同模型留定制化模板；
- 为每个场景维护基准测试样本；
- 模型迁移前先跑回归。

### 9.5 坑五：日志打太多，把敏感数据也带进去了

AI 调用为了排查问题，大家很容易把完整 Prompt、用户输入、模型输出全量打日志。但一旦内容包含合同、工单、手机号、邮箱、身份证等，合规风险会很大。

#### 正确做法

- 默认日志脱敏；
- 只保留 trace id 和摘要；
- 必要时把原始内容加密落库；
- 区分开发环境与生产环境日志粒度。

示例脱敏：

```php
function maskSensitive(string $content): string
{
    $content = preg_replace('/1\d{10}/', '1**********', $content);
    $content = preg_replace('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', '***@***.***', $content);

    return $content;
}
```

### 9.6 坑六：结构化提取任务里，模型“看起来懂了”，但字段总是漂

例如你要提取合同信息：甲方、乙方、金额、签约日期。模型大部分时候都能给对，但总有一部分边缘输入会错位。

#### 本质原因

- 输入文档噪声太高；
- Prompt 约束不够；
- 输出 schema 不明确；
- 没有做字段级校验与补偿。

#### 经验做法

- 给模型明确 JSON Schema；
- 对字段逐项校验；
- 高风险字段引入规则引擎或二次确认；
- 不把 LLM 结果直接当最终真值。

### 9.7 坑七：队列重试导致重复调用，成本翻倍

有一次我们遇到一个问题：上游实际上已经返回成功，但在写库前 Job 因数据库连接闪断抛错，Laravel 自动重试，结果同一个任务又调了一次模型，账单直接翻倍。

#### 后来怎么修

- 每次请求生成 `trace_id`；
- 调用前先检查任务是否已有成功结果；
- 对外部调用和内部写库分阶段落状态；
- 关键任务加幂等锁。

比如：

```php
$lock = Cache::lock('ai-task-'.$task->id, 120);

if (! $lock->get()) {
    return;
}

try {
    // 执行业务
} finally {
    optional($lock)->release();
}
```

### 9.8 坑八：以为温度越低越稳定，结果输出质量太僵硬

很多教程会说结构化场景把 `temperature` 设为 0。这个思路没错，但在某些总结、润色、营销文案场景里，过低温度会导致输出极度模板化，甚至错失一些表达变化。

#### 我的经验值

- 分类/提取/JSON 输出：`0 ~ 0.2`
- 总结/改写：`0.2 ~ 0.5`
- 创意生成：`0.6 ~ 0.9`

不要凭感觉一把梭，最好按场景分层配置。

### 9.9 坑九：把 AI 当万能函数，结果系统边界失控

这是最深的一类坑。很多项目接入 LLM 后，任何“不太确定的逻辑”都想扔给模型做。久而久之，系统会出现：

- 可解释性变差；
- 回归测试困难；
- 成本不可预测；
- 结果一致性下降；
- 出问题时根因难定位。

#### 真正可持续的做法

让 LLM 做它擅长的事：

- 文本总结；
- 语义归类；
- 自然语言生成；
- 非精确但高价值的辅助判断。

而不要让它取代：

- 精确计费；
- 权限判断；
- 交易状态机；
- 核心规则计算；
- 强一致性逻辑。

AI 是能力增强层，不是业务规则主脑。

---

## 十、一个可落地的 Laravel + LLM 集成建议清单

为了方便你真正落地，我把前面的内容收敛成一个比较务实的实施清单。

### 第一步：先统一接口，再接供应商

先定义 `LlmClientInterface`、`ChatRequest`、`ChatResponse`，再接 OpenAI / Claude / Ollama，不要反过来。

### 第二步：把 AI 集成注册进 Service Provider

让所有业务通过容器获取 `LlmManager`，而不是四处 new Client。

### 第三步：按业务场景封装 Service

例如：

- `ArticleSummaryService`
- `TicketAnalysisService`
- `ContractExtractionService`
- `MarketingCopyService`

Prompt 不要散落在 Controller。

### 第四步：Prompt 模板化

从文件模板起步，复杂后再引入数据库模板与版本控制。

### 第五步：一开始就记录 token、耗时和成本

不要等账单爆炸后才补埋点。

### 第六步：同步与异步分场景

- Chat、实时问答、即时改写：可同步 + Streaming；
- 批处理、长文本生成、知识整理：优先队列异步。

### 第七步：把失败当常态设计

准备好：

- 超时；
- 重试；
- 降级；
- 熔断；
- 缓存；
- 结构校验；
- 告警。

### 第八步：建立回归样本集

每个关键 Prompt 场景都准备一批固定样本，模型切换、Prompt 调整、参数变更前先跑回归。

---

## 结语

在 Laravel 后端集成 LLM，本质上不是“在 PHP 里调用一次 AI API”，而是把不确定的模型能力纳入确定的工程系统。你真正要建设的，不只是一个请求函数，而是一套围绕模型能力的后端基础设施：统一接口、Provider 封装、Prompt 管理、流式输出、计费埋点、错误恢复、异步队列、审计追踪和场景化服务抽象。

如果你把这些基础打好，Laravel 会成为承载 AI 能力非常顺手的框架：它不只是能接入模型，还能把模型纳入你现有的工程秩序中，让 AI 从“演示功能”变成“稳定生产力”。

最后给一个我非常认同的经验总结：

**不要追求一上来就做一个无所不能的 AI 平台，而是从一个清晰、可衡量、可回滚的业务场景切入，把 LLM 能力工程化、产品化，再逐步扩展。**

当你这样做时，AI 与 Laravel 的结合，才会真正从“会调接口”走向“可上线、可维护、可盈利”。

## 相关阅读

- [AI Agent + CI/CD 实战：把代码评审、质量检查与流水线自动化串起来](/categories/AI%20Agent/AI-Agent-CICD-Code-Review/)
- [RAG 系统实战：向量数据库、分块策略与检索链路设计](/categories/AI%20Agent/RAG-Vector-DB-Chunking-Retrieval/)
- [AI Agent 代码助手实战：代码生成、Review、重构与文档生成](/categories/AI%20Agent/AI-Agent-代码助手实战-代码生成-Review-重构-文档生成/)
- [AI 成本优化：Token 缓存、模型分级与应用侧成本治理](/categories/AI/2026-06-02-ai-application-cost-optimization-token-caching-model-degradation/)
- [AI Agent 安全实战：Prompt Injection、防越权与权限控制](/categories/AI/ai-agent-security-prompt-injection-permission-control/)
- [Dify 实战：低代码 AI 工作流平台的落地方式与适用边界](/categories/AI/dify-workflow-guide-low-code-ai-platform/)
