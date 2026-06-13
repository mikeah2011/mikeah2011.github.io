---

title: AI SDK for PHP 实战：Vercel AI SDK 的 PHP 版——统一 LLM 调用、流式响应与工具调用的抽象层设计
keywords: [AI SDK for PHP, Vercel AI SDK, PHP, LLM, 统一, 调用, 流式响应与工具调用的抽象层设计]
date: 2026-06-04 15:00:00
tags:
- ai-sdk
- PHP
- LLM
- Vercel
- 流式响应
- 工具调用
- Laravel
description: 深入解析如何为 PHP 构建对标 Vercel AI SDK 的统一抽象层——AI SDK for PHP。文章涵盖 Provider 接口设计、OpenAI 与 Anthropic 多供应商无缝切换、基于 SSE 的流式响应实现、多步工具调用编排（ToolRunner）、JSON Schema 结构化输出验证，以及 Laravel Service Provider、Facade、Middleware 完整集成方案。包含连接池优化、指数退避重试、Token 计数等生产环境踩坑经验，帮助 PHP 开发者以统一接口调用主流 LLM，快速构建 AI 驱动的 Web 应用。
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



## 前言

在 2024 至 2026 年的大模型浪潮中，JavaScript 和 TypeScript 生态凭借 Vercel AI SDK 迅速建立了统一的 LLM 调用范式。开发者只需调用 `generateText`、`streamText`、`generateObject` 等简洁 API，即可在 OpenAI、Anthropic、Google Gemini 等供应商之间无缝切换，无需关心底层 API 的格式差异。这种抽象层设计极大地降低了 AI 应用的开发门槛，也让模型选型变成了一个可插拔的配置项。

然而，PHP 作为全球 Web 市场占有率最高的服务端语言——WordPress、Laravel、Drupal 等框架支撑着数百万活跃应用——却长期缺乏一个类似水准的 AI SDK 抽象层。虽然 PHP 社区有一些优秀的单供应商封装库，但它们都无法解决"一次编写，多供应商运行"的核心问题。

本文将系统性地介绍如何为 PHP 构建一个对标 Vercel AI SDK 的统一抽象层——**AI SDK for PHP**。我们将从架构设计出发，逐步实现统一调用接口、流式响应、工具调用、结构化输出、Laravel 集成以及生产环境的性能优化，每个环节都提供可直接运行的完整代码示例。无论你是 Laravel 开发者想要快速接入 AI 能力，还是 PHP 架构师在设计 AI 中间件层，这篇文章都能为你提供一个完整的技术方案。

<!-- more -->

---

## 一、为什么 PHP 需要一个 AI SDK 抽象层？

### 1.1 LLM API 的碎片化现状

当前主流大语言模型供应商的 API 设计各不相同，差异体现在请求格式、响应结构、消息模型、流式事件格式等多个维度。

**OpenAI** 的接口路径为 `/v1/chat/completions`，使用 `messages` 数组作为对话载体，工具定义通过 `tools` 字段传递，流式响应采用 SSE 协议，每个事件携带一个 `delta` 对象。这是目前被模仿最多的接口格式，许多开源模型和推理框架都兼容这一规范。

**Anthropic** 的接口路径为 `/v1/messages`，与 OpenAI 有几个关键差异：`system` 消息是独立的顶级字段，不混入 `messages` 数组；工具定义使用 `input_schema` 而非 `parameters`；响应结构中 `content` 是一个包含多种类型块（text、tool_use）的数组，而非简单的字符串；流式事件的类型更加丰富，包括 `message_start`、`content_block_start`、`content_block_delta` 等多种事件类型。

**Google Gemini** 采用完全不同的 REST 风格 URL（`/v1beta/models/{model}:generateContent`），消息内容使用 `parts` 数组而非简单的字符串 `content`，角色名称为 `model` 而非 `assistant`，配置字段的位置和命名也与前两者大相径庭。

**Ollama** 作为本地推理服务，虽然在一定程度上兼容了 OpenAI 的接口格式，但在模型管理（`keep_alive` 参数）、嵌入向量接口、模型列表接口等方面仍有自己的独特实现。

如果开发者在项目中直接对接每一家供应商的原生 API，将面临以下困境：

**第一，接口不统一导致的重复编码。** 每个供应商的消息格式转换、错误处理、响应解析都需要独立编写。当一个项目需要同时支持多家供应商做 A/B 测试或降级容灾时，代码复杂度会呈线性增长。

**第二，供应商切换成本极高。** 如果项目最初基于 OpenAI 开发，后来因为价格、延迟或能力差异需要迁移到 Anthropic，几乎需要重写所有与 LLM 交互的代码——不仅是调用层，还包括消息构建、工具调用解析、流式事件处理等所有相关模块。

**第三，通用功能的重复实现。** 重试逻辑、速率限制处理、token 数量估算、请求超时管理、错误分类与降级策略等通用功能，每个供应商封装都需要从头实现一遍。这不仅浪费开发时间，还容易因为各处实现的细微差异导致难以排查的 bug。

**第四，工具调用适配繁琐。** 每个供应商的 function calling 或 tool use 的 schema 定义方式不同，参数传递格式不同，结果解析逻辑也不同。要实现一个多工具编排的 Agent，需要为每个供应商编写独立的编排逻辑。

### 1.2 现有 PHP 库的局限

PHP 社区目前有不少 AI 相关的开源库，其中最有影响力的是以下两个：

**`openai-php/client`** 是由 Laravel 核心团队成员（Nuno Maduro 等）维护的 OpenAI PHP 封装库，API 设计优雅，与 Laravel 集成良好，是目前 PHP 社区中质量最高的 OpenAI 客户端之一。但它本质上仍然只支持 OpenAI 一家供应商。如果要支持 Anthropic，你需要引入另一个完全不同的客户端库，学习另一套 API，写另一套代码。

**`orhanerday/open-ai`** 是更早期的 OpenAI PHP 封装，功能较为基础，不支持结构化输出和高级工具调用，代码风格偏向过程式，缺乏类型安全。

这两个库都是优秀的**单供应商封装**，但它们解决的是"如何调用 OpenAI API"的问题，而不是"如何在不同 LLM 供应商之间自由切换"的问题。这正是 AI SDK 抽象层要填补的空白。

### 1.3 Vercel AI SDK 的启示

Vercel AI SDK（npm 包名 `ai`）的核心设计哲学可以概括为四点：

**Provider 无关**——通过 `provider` 对象注入底层实现，调用代码完全不知道正在使用哪个供应商。你可以用 `openai('gpt-4o')` 调用 OpenAI，也可以换成 `anthropic('claude-sonnet-4-20250514')` 调用 Anthropic，调用方式完全一致。

**流式优先**——所有核心 API 同时提供同步（`generateText`）和流式（`streamText`）两个版本，返回值的设计也考虑了流式消费场景。

**类型安全**——利用 Zod schema 进行结构化输出的定义和验证，确保 LLM 返回的数据格式严格符合预期。

**工具调用一等公民**——原生支持多工具定义、参数验证、多步工具调用编排，让构建 AI Agent 变得简单。

这套设计哲学完全可以移植到 PHP 中。而且 Laravel 的服务容器、中间件、Facade、事件系统等基础设施可以让集成更加顺滑和符合 PHP 开发者的习惯。

---

## 二、Vercel AI SDK 设计哲学与 PHP 移植方案

### 2.1 核心概念映射

在开始编码之前，我们需要明确 TypeScript 版本和 PHP 版本之间的概念映射关系。Vercel AI SDK 的核心抽象包括 `provider`、`generateText`、`streamText`、`generateObject`、`tool` 等，在 PHP 中我们可以找到对应的实现方式。`provider` 对应 PHP 接口 `ProviderInterface`，每个供应商实现该接口；`generateText()` 对应静态方法 `AI::generateText()`，返回同步结果；`streamText()` 对应 `AI::streamText()`，返回可迭代的流式响应对象；`tool()` 工厂函数对应 `Tool::define()` 静态方法；Zod 的 `z.object({})` 在 PHP 中可以通过一个链式构建器或简洁的数组结构来表达。

需要注意的是，TypeScript 和 PHP 有本质的差异。TypeScript 是单线程、事件驱动的运行时，天然适合异步流式处理；PHP 是进程模型，每次请求一个进程，需要通过 SSE（Server-Sent Events）和输出缓冲控制来实现流式效果。这一点我们将在第四章详细讨论。

### 2.2 架构分层

整个 SDK 采用四层架构设计：

**顶层是 Facade 层**，提供 `AI::generateText()`、`AI::streamText()` 等静态调用入口，对使用者屏蔽所有内部细节。

**第二层是核心层**，包含消息构建器（MessageBuilder）、流式解析器（StreamParser）、工具执行器（ToolRunner）、Schema 验证器（SchemaValidator）、Token 计数器（TokenCounter）、重试策略（RetryPolicy）等核心组件。

**第三层是供应商层**，每个供应商（OpenAI、Anthropic、Gemini、Ollama）实现 `ProviderInterface` 接口，负责将统一的消息格式转换为供应商特定的请求格式，并将供应商特定的响应解析为统一的结果格式。这是抽象层的关键所在——格式转换的复杂性被封装在各 Provider 内部，对上层完全透明。

**底层是传输层**，基于 Guzzle HTTP 客户端实现 HTTP 请求和 SSE 流解析，支持连接池、超时配置等底层网络功能。

---

## 三、统一 LLM 调用接口

### 3.1 Provider 接口设计

接口是抽象层的核心契约。每个供应商必须实现 `ProviderInterface`，该接口定义了三个核心方法：同步文本生成 `generateText`、流式文本生成 `streamText`、以及结构化输出 `generateObject`。这三个方法覆盖了 LLM 应用中最常见的三种调用模式。

```php
<?php

namespace AISdk\Contracts;

use AISdk\Options\GenerateOptions;
use AISdk\Options\StreamOptions;
use AISdk\Results\GenerateResult;
use AISdk\Results\ObjectResult;
use AISdk\Streaming\StreamIterator;

interface ProviderInterface
{
    /**
     * 获取供应商名称标识
     */
    public function getName(): string;

    /**
     * 获取该供应商支持的模型列表
     */
    public function getSupportedModels(): array;

    /**
     * 同步文本生成
     *
     * @param array $messages 统一格式的消息数组
     * @param GenerateOptions $options 生成选项（模型、温度、工具等）
     * @return GenerateResult 统一格式的生成结果
     */
    public function generateText(
        array $messages,
        GenerateOptions $options
    ): GenerateResult;

    /**
     * 流式文本生成
     *
     * @param array $messages 统一格式的消息数组
     * @param StreamOptions $options 流式选项
     * @return StreamIterator 可迭代的流式结果
     */
    public function streamText(
        array $messages,
        StreamOptions $options
    ): StreamIterator;

    /**
     * 结构化输出（JSON Schema 约束）
     *
     * @param array $messages 消息数组
     * @param array $jsonSchema JSON Schema 定义
     * @param GenerateOptions $options 生成选项
     * @return ObjectResult 包含结构化对象的结果
     */
    public function generateObject(
        array $messages,
        array $jsonSchema,
        GenerateOptions $options
    ): ObjectResult;
}
```

这个接口的设计遵循了几个原则。首先是**消息格式统一**——所有供应商接收的 `$messages` 数组使用统一的消息类型（`SystemMessage`、`UserMessage`、`AssistantMessage`、`ToolMessage`），每个 Provider 内部负责将其转换为自己的格式。其次是**选项与配置分离**——`GenerateOptions` 封装了模型名称、温度、最大 token 数等通用参数，供应商特有的参数可以通过 `providerOptions` 数组传递。最后是**结果类型统一**——无论底层使用哪个供应商，返回的都是相同的 `GenerateResult` 或 `StreamIterator`。

### 3.2 OpenAI Provider 实现

OpenAI 是目前使用最广泛的 LLM 供应商，其实现也是最完整的参考。OpenAI Provider 需要处理几个关键的格式转换：将统一的 `Message` 对象数组转换为 OpenAI 的 `messages` 数组格式；将 `Tool` 对象数组转换为 OpenAI 的 `tools` 格式；将流式 SSE 事件解析为统一的 `StreamChunk` 对象。

```php
<?php

namespace AISdk\Providers;

use AISdk\Contracts\ProviderInterface;
use AISdk\Messages\{SystemMessage, UserMessage, AssistantMessage, ToolMessage};
use AISdk\Options\{GenerateOptions, StreamOptions};
use AISdk\Results\{GenerateResult, ObjectResult, Usage, ToolCall};
use AISdk\Streaming\{StreamIterator, StreamChunk};
use GuzzleHttp\Client;

class OpenAIProvider implements ProviderInterface
{
    private Client $http;
    private string $apiKey;
    private string $baseUrl;

    public function __construct(string $apiKey, string $baseUrl = 'https://api.openai.com/v1')
    {
        $this->apiKey = $apiKey;
        $this->baseUrl = $baseUrl;
        $this->http = new Client([
            'base_uri' => $baseUrl,
            'timeout'  => 120,
            'headers'  => [
                'Authorization' => "Bearer {$apiKey}",
                'Content-Type'  => 'application/json',
            ],
        ]);
    }

    public function getName(): string
    {
        return 'openai';
    }

    public function getSupportedModels(): array
    {
        return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'];
    }

    public function generateText(array $messages, GenerateOptions $options): GenerateResult
    {
        $payload = $this->buildPayload($messages, $options, stream: false);
        $response = $this->http->post('/chat/completions', ['json' => $payload]);
        $data = json_decode($response->getBody()->getContents(), true);

        return new GenerateResult(
            text: $data['choices'][0]['message']['content'] ?? '',
            usage: new Usage(
                promptTokens: $data['usage']['prompt_tokens'] ?? 0,
                completionTokens: $data['usage']['completion_tokens'] ?? 0,
            ),
            toolCalls: $this->extractToolCalls($data['choices'][0]['message'] ?? []),
            finishReason: $data['choices'][0]['finish_reason'] ?? 'stop',
        );
    }

    public function streamText(array $messages, StreamOptions $options): StreamIterator
    {
        $payload = $this->buildPayload($messages, $options, stream: true);
        $response = $this->http->post('/chat/completions', [
            'json'   => $payload,
            'stream' => true,
        ]);

        return new OpenAIStreamIterator($response->getBody());
    }

    /**
     * 构建 OpenAI 请求体
     * 这里完成了统一格式到 OpenAI 格式的转换
     */
    private function buildPayload(array $messages, $options, bool $stream): array
    {
        $payload = [
            'model'    => $options->model,
            'messages' => $this->formatMessages($messages),
            'stream'   => $stream,
        ];

        if ($options->temperature !== null) {
            $payload['temperature'] = $options->temperature;
        }
        if ($options->maxTokens !== null) {
            $payload['max_tokens'] = $options->maxTokens;
        }
        if (!empty($options->tools)) {
            $payload['tools'] = array_map(fn($tool) => [
                'type' => 'function',
                'function' => [
                    'name'        => $tool->name,
                    'description' => $tool->description,
                    'parameters'  => $tool->parameters,
                ],
            ], $options->tools);
        }

        return $payload;
    }

    /**
     * 将统一消息格式转换为 OpenAI messages 数组
     */
    private function formatMessages(array $messages): array
    {
        $formatted = [];
        foreach ($messages as $msg) {
            $entry = ['role' => $msg->getRole()];

            if ($msg instanceof SystemMessage) {
                $entry['content'] = $msg->content;
            } elseif ($msg instanceof UserMessage) {
                $entry['content'] = $msg->content;
            } elseif ($msg instanceof AssistantMessage) {
                $entry['content'] = $msg->content;
                if (!empty($msg->toolCalls)) {
                    $entry['tool_calls'] = array_map(fn($tc) => [
                        'id'   => $tc->id,
                        'type' => 'function',
                        'function' => [
                            'name'      => $tc->name,
                            'arguments'=> json_encode($tc->arguments),
                        ],
                    ], $msg->toolCalls);
                }
            } elseif ($msg instanceof ToolMessage) {
                $entry['role'] = 'tool';
                $entry['tool_call_id'] = $msg->toolCallId;
                $entry['content'] = $msg->content;
            }

            $formatted[] = $entry;
        }
        return $formatted;
    }
}
```

### 3.3 Anthropic Provider 实现——展示差异处理

Anthropic 的 API 与 OpenAI 有显著差异，这恰好是抽象层价值的最佳体现。我们来看几个关键的差异点。

首先，Anthropic 的 `system` 消息是顶级字段，不能放在 `messages` 数组中。这意味着我们需要在 `formatMessages` 中先把系统消息提取出来，单独放到请求体的 `system` 字段。其次，Anthropic 的工具定义使用 `input_schema` 而非 `parameters`，字段名称不同但结构相同。最后，Anthropic 的响应格式完全不同——`content` 是一个数组，每个元素有 `type` 字段区分 `text` 和 `tool_use` 两种类型。

```php
<?php

namespace AISdk\Providers;

class AnthropicProvider implements ProviderInterface
{
    // 构造函数、HTTP 客户端初始化等省略，与 OpenAI 类似

    public function getName(): string
    {
        return 'anthropic';
    }

    public function generateText(array $messages, GenerateOptions $options): GenerateResult
    {
        // 关键差异一：提取系统消息为顶级字段
        $systemMessage = null;
        $chatMessages = [];

        foreach ($messages as $msg) {
            if ($msg instanceof SystemMessage) {
                $systemMessage = $msg->content;
            } else {
                $chatMessages[] = $this->formatMessage($msg);
            }
        }

        $payload = [
            'model'      => $options->model,
            'max_tokens' => $options->maxTokens ?? 4096,
            'messages'   => $chatMessages,
        ];

        if ($systemMessage !== null) {
            $payload['system'] = $systemMessage;
        }

        // 关键差异二：工具定义使用 input_schema
        if (!empty($options->tools)) {
            $payload['tools'] = array_map(fn($tool) => [
                'name'         => $tool->name,
                'description'  => $tool->description,
                'input_schema' => $tool->parameters, // 注意字段名不同
            ], $options->tools);
        }

        $response = $this->http->post('/v1/messages', ['json' => $payload]);
        $data = json_decode($response->getBody()->getContents(), true);

        // 关键差异三：响应解析逻辑完全不同
        $text = '';
        $toolCalls = [];
        foreach ($data['content'] as $block) {
            match ($block['type']) {
                'text'      => $text .= $block['text'],
                'tool_use'  => $toolCalls[] = new ToolCall(
                    id: $block['id'],
                    name: $block['name'],
                    arguments: $block['input'],
                ),
            };
        }

        return new GenerateResult(
            text: $text,
            usage: new Usage(
                promptTokens: $data['usage']['input_tokens'] ?? 0,
                completionTokens: $data['usage']['output_tokens'] ?? 0,
            ),
            toolCalls: $toolCalls,
            finishReason: $data['stop_reason'] ?? 'end_turn', // Anthropic 用 end_turn 而非 stop
        );
    }

    // streamText 和其他方法省略...
}
```

可以看到，仅仅是 `generateText` 一个方法，OpenAI 和 Anthropic 的实现就有三处关键差异。如果每个项目都要手动处理这些差异，维护成本会非常高。通过 Provider 接口抽象，这些差异被封装在各自的 Provider 内部，上层调用者完全不需要关心。

### 3.4 统一调用入口——AI 类

有了 Provider 接口和各供应商实现，我们可以设计一个统一的调用入口。这个入口类的设计借鉴了 Vercel AI SDK 的 `generateText` 等函数，但在 PHP 中我们使用静态方法和 Laravel 的 Facade 模式来实现同样简洁的调用体验。

```php
<?php

namespace AISdk;

use AISdk\Contracts\ProviderInterface;
use AISdk\Messages\{SystemMessage, UserMessage};
use AISdk\Options\{GenerateOptions, StreamOptions};

class AI
{
    private static array $providers = [];
    private static string $defaultProvider = 'openai';

    /**
     * 注册一个供应商
     */
    public static function provider(string $name, ProviderInterface $provider): void
    {
        self::$providers[$name] = $provider;
    }

    /**
     * 设置默认供应商
     */
    public static function default(string $name): void
    {
        self::$defaultProvider = $name;
    }

    /**
     * 获取指定供应商实例
     */
    public static function getProvider(string $name): ProviderInterface
    {
        return self::$providers[$name]
            ?? throw new \RuntimeException("Provider '{$name}' not registered. Available: " .
                implode(', ', array_keys(self::$providers)));
    }

    /**
     * 同步文本生成
     */
    public static function generateText(string $prompt, array $options = []): Results\GenerateResult
    {
        $providerName = $options['provider'] ?? self::$defaultProvider;
        $provider = self::getProvider($providerName);

        $messages = [];
        if (isset($options['system'])) {
            $messages[] = new SystemMessage($options['system']);
        }
        $messages[] = new UserMessage($prompt);

        return $provider->generateText($messages, GenerateOptions::from($options));
    }

    /**
     * 流式文本生成
     */
    public static function streamText(string|array $messages, array $options = []): Streaming\StreamResponse
    {
        $providerName = $options['provider'] ?? self::$defaultProvider;
        $provider = self::getProvider($providerName);

        if (is_string($messages)) {
            $messages = [new UserMessage($messages)];
            if (isset($options['system'])) {
                array_unshift($messages, new SystemMessage($options['system']));
            }
        }

        return new Streaming\StreamResponse(
            $provider->streamText($messages, StreamOptions::from($options))
        );
    }

    /**
     * 结构化输出
     */
    public static function generateObject(
        string $prompt,
        array $schema,
        array $options = []
    ): Results\ObjectResult {
        $providerName = $options['provider'] ?? self::$defaultProvider;
        $provider = self::getProvider($providerName);

        $messages = [];
        if (isset($options['system'])) {
            $messages[] = new SystemMessage($options['system']);
        }
        $messages[] = new UserMessage($prompt);

        return $provider->generateObject($messages, $schema, GenerateOptions::from($options));
    }
}
```

使用时只需注册供应商，之后的调用完全一致：

```php
// 在启动时注册（通常在 Laravel Service Provider 中）
AI::provider('openai', new OpenAIProvider(env('OPENAI_API_KEY')));
AI::provider('anthropic', new AnthropicProvider(env('ANTHROPIC_API_KEY')));
AI::provider('ollama', new OllamaProvider('http://localhost:11434'));

// 调用方式完全一致，只改 provider 参数即可切换
$result = AI::generateText('用 PHP 实现一个快速排序算法', [
    'provider'  => 'anthropic',  // 改成 'openai' 即切换供应商
    'model'     => 'claude-sonnet-4-20250514',
    'system'    => '你是一个 PHP 专家。',
    'maxTokens' => 2048,
]);

echo $result->text;
```

---

## 四、流式响应实现：SSE 与分块传输

### 4.1 PHP 流式响应的技术背景

PHP 传统的请求-响应模型是"收到请求 -> 处理 -> 一次性返回结果"，这与流式输出的需求看似矛盾。但 PHP 其实完全支持流式响应，只是需要正确配置几个关键点。

首先是**输出缓冲控制**。PHP 和 Web 服务器通常会启用多层输出缓冲（PHP 的 `output_buffering`、Nginx 的 `proxy_buffering`、FastCGI 的缓冲），这些缓冲会阻止数据立即发送到客户端。要实现真正的流式输出，需要在每一层都禁用缓冲。

其次是**SSE（Server-Sent Events）协议**。这是一种基于 HTTP 的单向推送协议，服务器通过保持连接打开、持续发送 `data:` 前缀的文本块来实现流式推送。浏览器端可以通过 `EventSource` API 或 `fetch` + `ReadableStream` 来消费。

最后是**连接生命周期管理**。PHP-FPM 进程在处理流式请求时会长时间占用，这需要合理的超时配置和进程池管理，避免因大量并发流式请求耗尽进程池。

### 4.2 StreamIterator 设计

流式响应的核心是一个迭代器，将供应商特定的 SSE 事件流转换为统一的 `StreamChunk` 对象。每个 `StreamChunk` 包含三个关键信息：文本增量（`text`）、工具调用增量（`toolCalls`）和结束原因（`finishReason`）。

```php
<?php

namespace AISdk\Streaming;

use Psr\Http\Message\StreamInterface;

/**
 * OpenAI SSE 流迭代器
 * 负责将 OpenAI 的 SSE 格式解析为统一的 StreamChunk
 */
class OpenAIStreamIterator implements StreamIterator
{
    private StreamInterface $stream;
    private ?StreamChunk $current = null;
    private string $buffer = '';
    private bool $valid = true;
    private int $retryTimeout = 0;

    public function __construct(StreamInterface $stream)
    {
        $this->stream = $stream;
    }

    public function current(): ?StreamChunk
    {
        return $this->current;
    }

    public function next(): void
    {
        $this->current = $this->readNextChunk();
    }

    public function valid(): bool
    {
        return $this->valid;
    }

    public function rewind(): void
    {
        // 流是单向的，不可重绕
    }

    /**
     * 从 SSE 流中读取并解析下一个数据块
     */
    private function readNextChunk(): ?StreamChunk
    {
        while (!$this->stream->eof()) {
            // 读取数据到缓冲区
            $bytes = $this->stream->read(8192);
            if ($bytes === '' || $bytes === false) {
                $this->valid = false;
                return null;
            }

            $this->buffer .= $bytes;

            // 按 SSE 事件分隔符（双换行）拆分
            while (($pos = strpos($this->buffer, "\n\n")) !== false) {
                $rawEvent = substr($this->buffer, 0, $pos);
                $this->buffer = substr($this->buffer, $pos + 2);

                // 解析 SSE 事件中的每一行
                $eventLines = explode("\n", $rawEvent);
                foreach ($eventLines as $line) {
                    if (str_starts_with($line, 'data: ')) {
                        $jsonData = substr($line, 6);

                        // [DONE] 标记流的结束
                        if (trim($jsonData) === '[DONE]') {
                            $this->valid = false;
                            return null;
                        }

                        $data = json_decode($jsonData, true);
                        if (json_last_error() !== JSON_ERROR_NONE) {
                            continue; // 跳过无效 JSON
                        }

                        $delta = $data['choices'][0]['delta'] ?? null;
                        if ($delta === null) {
                            continue;
                        }

                        return new StreamChunk(
                            text: $delta['content'] ?? '',
                            toolCalls: $this->parseToolCallDeltas($delta['tool_calls'] ?? []),
                            finishReason: $data['choices'][0]['finish_reason'] ?? null,
                        );
                    }

                    // 处理 retry 字段
                    if (str_starts_with($line, 'retry: ')) {
                        $this->retryTimeout = (int) substr($line, 7);
                    }
                }
            }
        }

        $this->valid = false;
        return null;
    }

    /**
     * 解析工具调用增量
     * OpenAI 的工具调用是分块传输的，需要累积拼接
     */
    private function parseToolCallDeltas(array $deltas): array
    {
        $toolCalls = [];
        foreach ($deltas as $delta) {
            $toolCalls[] = new ToolCallDelta(
                index: $delta['index'] ?? 0,
                id: $delta['id'] ?? null,
                name: $delta['function']['name'] ?? null,
                argumentsDelta: $delta['function']['arguments'] ?? '',
            );
        }
        return $toolCalls;
    }
}
```

### 4.3 Anthropic SSE 差异处理

Anthropic 的流式事件格式比 OpenAI 复杂得多，包含了更细粒度的事件类型。`message_start` 事件标记对话开始，`content_block_start` 事件标记一个内容块的开始，`content_block_delta` 事件携带文本增量，`message_delta` 事件携带停止原因等顶层信息，`message_stop` 事件标记整个消息的结束。

为此，我们为 Anthropic 实现一个专用的 `AnthropicStreamIterator`，它理解 Anthropic 的事件类型，但对外暴露的 `StreamChunk` 接口与 OpenAI 完全一致。这就是抽象层的核心价值——复杂性被封装在 Provider 内部，对使用者透明。

```php
<?php

namespace AISdk\Streaming;

/**
 * Anthropic SSE 流迭代器
 * 处理 Anthropic 特有的多类型事件流
 */
class AnthropicStreamIterator implements StreamIterator
{
    private StreamInterface $stream;
    private string $buffer = '';
    private bool $valid = true;

    // Anthropic 的工具调用需要累积参数片段
    private array $toolCallBuffers = [];

    public function current(): ?StreamChunk
    {
        return $this->readNextChunk();
    }

    public function next(): void { /* readNextChunk 在 valid() 中驱动 */ }

    public function valid(): bool
    {
        return $this->valid;
    }

    private function readNextChunk(): ?StreamChunk
    {
        while (!$this->stream->eof()) {
            $this->buffer .= $this->stream->read(8192);

            while (($pos = strpos($this->buffer, "\n\n")) !== false) {
                $rawEvent = substr($this->buffer, 0, $pos);
                $this->buffer = substr($this->buffer, $pos + 2);

                $eventType = null;
                $jsonData = null;

                foreach (explode("\n", $rawEvent) as $line) {
                    if (str_starts_with($line, 'event: ')) {
                        $eventType = substr($line, 7);
                    } elseif (str_starts_with($line, 'data: ')) {
                        $jsonData = json_decode(substr($line, 6), true);
                    }
                }

                if ($jsonData === null) continue;

                // 根据事件类型提取内容
                return match ($eventType) {
                    'content_block_delta' => new StreamChunk(
                        text: $jsonData['delta']['text'] ?? '',
                        toolCalls: [],
                        finishReason: null,
                    ),
                    'message_delta' => new StreamChunk(
                        text: '',
                        toolCalls: [],
                        finishReason: $jsonData['delta']['stop_reason'] ?? null,
                    ),
                    'content_block_start' when ($jsonData['content_block']['type'] ?? '') === 'tool_use'
                        => $this->handleToolUseStart($jsonData),
                    default => null,
                };
            }
        }

        $this->valid = false;
        return null;
    }
}
```

### 4.4 Laravel 中的 SSE 控制器

有了 StreamIterator，接下来在 Laravel 中实现 SSE 端点就非常直观了。关键是正确设置响应头，确保每一层缓冲都被禁用。

```php
<?php

namespace App\Http\Controllers;

use AISdk\AI;
use Illuminate\Http\Request;

class ChatStreamController extends Controller
{
    public function stream(Request $request)
    {
        $request->validate([
            'message'  => 'required|string|max:4096',
            'provider' => 'sometimes|string|in:openai,anthropic,ollama',
            'model'    => 'sometimes|string',
        ]);

        return response()->stream(function () use ($request) {
            try {
                $stream = AI::streamText($request->input('message'), [
                    'provider'  => $request->input('provider', 'openai'),
                    'model'     => $request->input('model', 'gpt-4o'),
                    'system'    => '你是一个专业的技术助手，擅长用简洁清晰的中文回答问题。',
                    'maxTokens' => 2048,
                ]);

                foreach ($stream as $chunk) {
                    // 发送文本增量
                    if (!empty($chunk->text)) {
                        $this->sse('text', ['text' => $chunk->text]);
                    }

                    // 发送工具调用
                    if (!empty($chunk->toolCalls)) {
                        $this->sse('tool_call', ['calls' => $chunk->toolCalls]);
                    }

                    // 流结束标记
                    if ($chunk->finishReason) {
                        $this->sse('done', [
                            'reason' => $chunk->finishReason,
                        ]);
                        break;
                    }
                }
            } catch (\Throwable $e) {
                $this->sse('error', [
                    'message' => $e->getMessage(),
                ]);
            }
        }, 200, [
            'Content-Type'                => 'text/event-stream',
            'Cache-Control'               => 'no-cache, no-store',
            'X-Accel-Buffering'           => 'no',  // Nginx 禁用缓冲
            'Connection'                  => 'keep-alive',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    /**
     * 发送一个 SSE 事件
     */
    private function sse(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";

        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}
```

### 4.5 Nginx 配置注意事项

在 Nginx 作为反向代理的环境中，需要特别注意禁用代理缓冲。否则 Nginx 会等待后端响应完全结束后才一次性转发给客户端，导致流式效果失效。

```nginx
location /api/chat/stream {
    proxy_pass http://php-fpm;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;           # 关键：禁用代理缓冲
    proxy_cache off;
    chunked_transfer_encoding on;
    proxy_read_timeout 300s;       # 流式请求可能持续较长时间
}
```

---

## 五、工具调用（Tool Calling）

### 5.1 工具定义的 PHP 表达

工具调用是让 LLM 与外部世界交互的关键能力。在 AI SDK for PHP 中，我们用一个 `Tool` 类来封装工具的定义，包含四个要素：名称（`name`）、描述（`description`）、参数 schema（`parameters`，符合 JSON Schema 规范）和执行函数（`execute`）。

```php
<?php

namespace AISdk\Tools;

class Tool
{
    public function __construct(
        public readonly string $name,
        public readonly string $description,
        public readonly array $parameters,
        public readonly \Closure $execute,
    ) {}

    /**
     * 静态工厂方法，提供更友好的定义方式
     */
    public static function define(array $config): self
    {
        return new self(
            name: $config['name'],
            description: $config['description'],
            parameters: $config['parameters'] ?? ['type' => 'object', 'properties' => []],
            execute: $config['execute'],
        );
    }
}
```

参数 schema 采用标准的 JSON Schema 格式定义。这是一个有意的设计选择——JSON Schema 是业界通用的 schema 规范，LLM 供应商的工具定义接口都支持这一格式，使用标准格式可以最大程度地保证兼容性。

### 5.2 实际工具示例

在真实项目中，工具通常是对外部 API 或内部服务的封装。以下是几个典型的工具定义示例，展示不同复杂度的工具场景。

```php
<?php

use AISdk\Tools\Tool;

// 工具一：天气查询（简单 API 调用）
$weatherTool = Tool::define([
    'name'        => 'get_weather',
    'description' => '获取指定城市的当前天气信息，包括温度、天气状况和湿度。当用户询问天气相关问题时使用此工具。',
    'parameters'  => [
        'type'       => 'object',
        'properties' => [
            'city' => [
                'type'        => 'string',
                'description' => '城市名称，如"北京"、"上海"、"New York"',
            ],
            'unit' => [
                'type'    => 'string',
                'enum'    => ['celsius', 'fahrenheit'],
                'default' => 'celsius',
            ],
        ],
        'required' => ['city'],
    ],
    'execute' => function (array $args): string {
        // 实际项目中这里会调用真实天气 API
        $city = $args['city'];
        $mockData = [
            '北京' => ['temperature' => 22, 'condition' => '多云', 'humidity' => 45],
            '上海' => ['temperature' => 26, 'condition' => '晴', 'humidity' => 68],
        ];
        $data = $mockData[$city] ?? ['temperature' => 20, 'condition' => '未知', 'humidity' => 50];

        return json_encode([
            'city'        => $city,
            'temperature' => $data['temperature'] . '°C',
            'condition'   => $data['condition'],
            'humidity'    => $data['humidity'] . '%',
            'updated_at'  => now()->toDateTimeString(),
        ], JSON_UNESCAPED_UNICODE);
    },
]);

// 工具二：数据库查询（内部服务调用，带安全约束）
$databaseTool = Tool::define([
    'name'        => 'query_database',
    'description' => '查询业务数据库中的订单、用户或收入数据。只能执行 SELECT 查询，不允许修改数据。',
    'parameters'  => [
        'type'       => 'object',
        'properties' => [
            'query_type' => [
                'type' => 'string',
                'enum' => ['order_status', 'user_orders', 'revenue_summary'],
                'description' => '查询类型',
            ],
            'filters' => [
                'type'       => 'object',
                'properties' => [
                    'user_id'   => ['type' => 'integer', 'description' => '用户 ID'],
                    'date_from' => ['type' => 'string', 'format' => 'date', 'description' => '起始日期 YYYY-MM-DD'],
                    'date_to'   => ['type' => 'string', 'format' => 'date', 'description' => '结束日期 YYYY-MM-DD'],
                ],
            ],
        ],
        'required' => ['query_type'],
    ],
    'execute' => function (array $args): string {
        $queryType = $args['query_type'];
        $filters = $args['filters'] ?? [];

        // 实际项目中通过 Repository 或 Eloquent 查询
        return match ($queryType) {
            'order_status'   => json_encode(['orders' => [['id' => 1001, 'status' => '已发货']]]),
            'user_orders'    => json_encode(['total' => 5, 'recent' => [...] ]),
            'revenue_summary'=> json_encode(['monthly_revenue' => 128500.00]),
            default          => json_encode(['error' => '未知查询类型']),
        };
    },
]);

// 工具三：代码执行（带安全沙箱）
$codeExecutionTool = Tool::define([
    'name'        => 'execute_php',
    'description' => '执行 PHP 代码片段并返回输出结果。仅用于数据计算和格式转换，禁止执行系统命令。',
    'parameters'  => [
        'type'       => 'object',
        'properties' => [
            'code' => ['type' => 'string', 'description' => '要执行的 PHP 代码'],
        ],
        'required' => ['code'],
    ],
    'execute' => function (array $args): string {
        $code = $args['code'];

        // 安全白名单检查
        $forbidden = ['exec', 'system', 'shell_exec', 'passthru', 'eval',
                      'file_get_contents', 'file_put_contents', 'unlink', 'rmdir'];
        foreach ($forbidden as $fn) {
            if (stripos($code, $fn) !== false) {
                return json_encode(['error' => "安全限制：禁止调用 {$fn}()"]);
            }
        }

        ob_start();
        try {
            eval($code);
            $output = ob_get_clean();
            return json_encode(['output' => $output, 'success' => true]);
        } catch (\Throwable $e) {
            if (ob_get_level() > 0) ob_end_clean();
            return json_encode(['error' => $e->getMessage(), 'success' => false]);
        }
    },
]);
```

### 5.3 多工具编排执行器（ToolRunner）

多工具编排是 AI Agent 的核心能力。当用户提出一个复杂问题时，LLM 可能需要先调用一个工具获取数据，再根据结果调用另一个工具进行进一步处理，这个过程可能需要多轮迭代。`ToolRunner` 负责管理这个编排循环。

其工作流程如下：首先将用户消息和可用工具列表发送给 LLM；LLM 返回文本结果或工具调用请求；如果包含工具调用请求，执行器依次调用对应工具并将结果以 `ToolMessage` 形式追加到消息历史；然后再次调用 LLM，让其根据工具返回结果继续生成回复；这个过程循环进行，直到 LLM 不再请求工具调用或达到最大轮数限制。

```php
<?php

namespace AISdk\Tools;

use AISdk\Contracts\ProviderInterface;
use AISdk\Messages\{AssistantMessage, ToolMessage};
use AISdk\Options\GenerateOptions;
use AISdk\Results\{GenerateResult, ToolCall};
use AISdk\Schema\SchemaValidator;

class ToolRunner
{
    /** @var array<string, Tool> */
    private array $tools = [];

    public function addTool(Tool $tool): self
    {
        $this->tools[$tool->name] = $tool;
        return $this;
    }

    /**
     * 注册多个工具
     * @param Tool[] $tools
     */
    public function addTools(array $tools): self
    {
        foreach ($tools as $tool) {
            $this->addTool($tool);
        }
        return $this;
    }

    /**
     * 执行带工具调用的对话循环
     *
     * 流程：
     * 1. 将工具列表注入选项
     * 2. 调用 LLM 生成回复
     * 3. 如果 LLM 返回工具调用，执行工具并追加结果到消息历史
     * 4. 重复步骤 2-3，直到 LLM 不再调用工具或达到最大步数
     * 5. 返回最终结果
     */
    public function runWithTools(
        ProviderInterface $provider,
        array $messages,
        GenerateOptions $options,
        int $maxSteps = 5
    ): GenerateResult {
        // 将注册的工具注入到选项中
        $options->tools = array_values($this->tools);

        for ($step = 0; $step < $maxSteps; $step++) {
            $result = $provider->generateText($messages, $options);

            // 如果没有工具调用请求，对话完成
            if (empty($result->toolCalls)) {
                return $result;
            }

            // 将助手的回复（包含工具调用请求）加入消息历史
            $messages[] = new AssistantMessage(
                content: $result->text,
                toolCalls: $result->toolCalls,
            );

            // 逐个执行工具调用
            foreach ($result->toolCalls as $toolCall) {
                $toolResult = $this->executeToolCall($toolCall);

                // 将工具执行结果作为 ToolMessage 追加到消息历史
                $messages[] = new ToolMessage(
                    toolCallId: $toolCall->id,
                    content: $toolResult,
                );
            }
        }

        // 超过最大步数仍未结束
        return $result;
    }

    /**
     * 执行单个工具调用，包含参数验证和错误处理
     */
    private function executeToolCall(ToolCall $toolCall): string
    {
        $tool = $this->tools[$toolCall->name] ?? null;

        if ($tool === null) {
            return json_encode([
                'error' => "Tool '{$toolCall->name}' is not available.",
            ]);
        }

        try {
            // 验证必需参数
            $this->validateParameters($tool, $toolCall->arguments);

            // 执行工具
            return ($tool->execute)($toolCall->arguments);
        } catch (\Throwable $e) {
            return json_encode([
                'error'   => get_class($e) . ': ' . $e->getMessage(),
                'tool'    => $toolCall->name,
                'args'    => $toolCall->arguments,
            ]);
        }
    }

    /**
     * 根据 JSON Schema 验证参数
     */
    private function validateParameters(Tool $tool, array $args): void
    {
        $required = $tool->parameters['required'] ?? [];

        foreach ($required as $field) {
            if (!array_key_exists($field, $args)) {
                throw new \InvalidArgumentException(
                    "Missing required parameter '{$field}' for tool '{$tool->name}'"
                );
            }
        }
    }
}
```

### 5.4 完整的工具调用使用示例

```php
<?php

use AISdk\AI;
use AISdk\Tools\ToolRunner;
use AISdk\Messages\{SystemMessage, UserMessage};
use AISdk\Options\GenerateOptions;

// 创建工具运行器并注册工具
$runner = new ToolRunner();
$runner->addTools([$weatherTool, $databaseTool]);

// 获取供应商
$provider = AI::getProvider('openai');

// 执行带工具调用的对话
$result = $runner->runWithTools(
    provider: $provider,
    messages: [
        new SystemMessage('你是一个智能助手，可以查询天气和订单信息。请根据工具返回的结果用中文回答用户。'),
        new UserMessage('帮我看看北京今天天气怎么样？另外查一下用户 12345 最近的订单状态。'),
    ],
    options: new GenerateOptions(
        model: 'gpt-4o',
        temperature: 0.7,
    ),
    maxSteps: 3,
);

echo $result->text;
// 输出示例：
// "北京今天天气多云，气温 22°C，湿度 45%。用户 12345 最近有一笔订单（#1001），
//  状态为已发货。"
```

在这个过程中，LLM 会自动决定先调用 `get_weather(city: "北京")`，再调用 `query_database(query_type: "user_orders", filters: {user_id: 12345})`，然后根据两次工具返回的结果生成一段自然语言回复。整个过程对终端用户是透明的。

---

## 六、结构化输出（Structured Output）

### 6.1 为什么需要结构化输出

在很多场景下，我们需要 LLM 返回的数据不是自由格式的文本，而是符合特定结构的 JSON 对象。例如：情感分析的结果需要包含 `sentiment`、`confidence` 等固定字段；数据提取任务需要返回包含特定字段的对象数组；API 网关需要用 LLM 做意图识别并返回结构化的指令。

如果只是简单地要求 LLM "返回 JSON"，LLM 可能会返回格式不一致的 JSON（有时是嵌套对象，有时是数组），甚至在 JSON 前后加上多余的文本说明。结构化输出通过 JSON Schema 约束来强制 LLM 返回符合预期格式的数据。

### 6.2 PHP 版 Schema 定义工具

借鉴 TypeScript 中 Zod 的声明式风格，我们设计了一套简洁的 PHP Schema 构建器。它不是 Zod 的完整移植，而是专注于 JSON Schema 的子集——足以覆盖 LLM 结构化输出的常见场景。

```php
<?php

namespace AISdk\Schema;

class Schema
{
    /**
     * 对象类型 schema
     */
    public static function object(array $properties, array $required = []): array
    {
        $schema = ['type' => 'object', 'properties' => $properties];
        if (!empty($required)) {
            $schema['required'] = $required;
        }
        return $schema;
    }

    /**
     * 字符串类型
     */
    public static function string(?string $description = null): array
    {
        $schema = ['type' => 'string'];
        if ($description) $schema['description'] = $description;
        return $schema;
    }

    /**
     * 整数类型
     */
    public static function integer(?string $description = null): array
    {
        $schema = ['type' => 'integer'];
        if ($description) $schema['description'] = $description;
        return $schema;
    }

    /**
     * 浮点数类型
     */
    public static function number(?string $description = null): array
    {
        $schema = ['type' => 'number'];
        if ($description) $schema['description'] = $description;
        return $schema;
    }

    /**
     * 布尔类型
     */
    public static function boolean(?string $description = null): array
    {
        $schema = ['type' => 'boolean'];
        if ($description) $schema['description'] = $description;
        return $schema;
    }

    /**
     * 数组类型
     */
    public static function array(array $items, ?string $description = null): array
    {
        $schema = ['type' => 'array', 'items' => $items];
        if ($description) $schema['description'] = $description;
        return $schema;
    }

    /**
     * 枚举类型（字符串枚举）
     */
    public static function enum(array $values, ?string $description = null): array
    {
        $schema = ['type' => 'string', 'enum' => $values];
        if ($description) $schema['description'] = $description;
        return $schema;
    }
}
```

### 6.3 使用示例：从非结构化文本中提取结构化数据

这是一个非常实用的场景——用户提交一段自由格式的文本，我们需要从中提取结构化的信息。

```php
<?php

use AISdk\AI;
use AISdk\Schema\Schema;

// 定义产品评价分析的 schema
$reviewSchema = Schema::object([
    'sentiment'    => Schema::enum(['positive', 'negative', 'mixed'], '整体情感倾向'),
    'rating'       => Schema::integer('推荐评分，1 到 10 分'),
    'summary'      => Schema::string('一句话总结评价内容'),
    'pros'         => Schema::array(Schema::string(), '优点列表'),
    'cons'         => Schema::array(Schema::string(), '缺点列表'),
    'keywords'     => Schema::array(Schema::string(), '关键词列表'),
    'mentioned_products' => Schema::array(
        Schema::object([
            'name'  => Schema::string('产品名称'),
            'brand' => Schema::string('品牌'),
            'sentiment' => Schema::enum(['positive', 'negative', 'neutral']),
        ]),
        '提到的产品'
    ),
], required: ['sentiment', 'rating', 'summary']);

$reviewText = "最近入手了 MacBook Pro M4 和 Dell U2723QE 显示器。MacBook 的性能确实很强，
M4 芯片跑深度学习模型比上一代快了不少，续航也很给力。但价格确实有点劝退。
显示器色彩准确，Type-C 一线通很方便，就是支架调节范围有点小。总体来说这套组合
办公和开发都很舒服，就是预算需要充裕一些。";

$result = AI::generateObject(
    prompt: "分析以下产品评价，提取结构化信息：\n\n{$reviewText}",
    schema: $reviewSchema,
    options: [
        'provider' => 'openai',
        'model'    => 'gpt-4o',
        'system'   => '你是一个专业的产品评价分析师，请准确提取评价中的结构化信息。',
    ],
);

// $result->object 是经过验证的关联数组
print_r($result->object);
// Array (
//     [sentiment] => mixed
//     [rating]    => 8
//     [summary]   => "MacBook Pro M4 性能强劲续航好但价格偏高，Dell 显示器色彩准一线通方便但支架一般"
//     [pros]      => Array ( [0] => "M4 芯片性能强" [1] => "续航给力" [2] => "显示器色彩准确" ... )
//     [cons]      => Array ( [0] => "价格偏高" [1] => "显示器支架调节范围小" )
//     [keywords]  => Array ( [0] => "MacBook Pro" [1] => "M4" [2] => "Dell U2723QE" ... )
//     [mentioned_products] => Array (
//         [0] => Array ( [name] => "MacBook Pro M4" [brand] => "Apple" [sentiment] => "positive" )
//         [1] => Array ( [name] => "U2723QE" [brand] => "Dell" [sentiment] => "positive" )
//     )
// )
```

### 6.4 Schema 验证器

为了确保 LLM 返回的数据严格符合 schema 定义，我们需要一个验证器。这个验证器在 Provider 的 `generateObject` 实现中被调用，对 LLM 返回的 JSON 进行校验。

```php
<?php

namespace AISdk\Schema;

class SchemaValidator
{
    /**
     * 验证数据是否符合 schema，返回错误列表（空数组表示通过）
     */
    public static function validate(mixed $data, array $schema, string $path = ''): array
    {
        $errors = [];
        self::doValidate($data, $schema, $path ?: 'root', $errors);
        return $errors;
    }

    private static function doValidate(mixed $data, array $schema, string $path, array &$errors): void
    {
        $type = $schema['type'] ?? null;

        match ($type) {
            'object'  => self::validateObject($data, $schema, $path, $errors),
            'array'   => self::validateArray($data, $schema, $path, $errors),
            'string'  => self::validateString($data, $schema, $path, $errors),
            'integer' => self::validateInteger($data, $schema, $path, $errors),
            'number'  => self::validateNumber($data, $schema, $path, $errors),
            'boolean' => is_bool($data) || ($errors[] = "{$path}: expected boolean, got " . gettype($data)),
            default   => null,
        };

        // 检查 enum 约束
        if (isset($schema['enum']) && !in_array($data, $schema['enum'], true)) {
            $allowed = implode(', ', array_map(fn($v) => "'{$v}'", $schema['enum']));
            $errors[] = "{$path}: value '{$data}' is not in allowed values [{$allowed}]";
        }
    }

    private static function validateObject(mixed $data, array $schema, string $path, array &$errors): void
    {
        if (!is_array($data) || array_is_list($data)) {
            $errors[] = "{$path}: expected object, got " . gettype($data);
            return;
        }

        // 检查必需字段
        foreach ($schema['required'] ?? [] as $field) {
            if (!array_key_exists($field, $data)) {
                $errors[] = "{$path}.{$field}: required property is missing";
            }
        }

        // 递归验证每个已定义的属性
        foreach ($schema['properties'] ?? [] as $key => $propSchema) {
            if (array_key_exists($key, $data)) {
                self::doValidate($data[$key], $propSchema, "{$path}.{$key}", $errors);
            }
        }
    }

    private static function validateArray(mixed $data, array $schema, string $path, array &$errors): void
    {
        if (!is_array($data)) {
            $errors[] = "{$path}: expected array, got " . gettype($data);
            return;
        }

        // 验证每个元素
        $itemsSchema = $schema['items'] ?? null;
        if ($itemsSchema) {
            foreach ($data as $index => $item) {
                self::doValidate($item, $itemsSchema, "{$path}[{$index}]", $errors);
            }
        }

        // 检查最小/最大长度
        if (isset($schema['minItems']) && count($data) < $schema['minItems']) {
            $errors[] = "{$path}: array has " . count($data) . " items, minimum is {$schema['minItems']}";
        }
        if (isset($schema['maxItems']) && count($data) > $schema['maxItems']) {
            $errors[] = "{$path}: array has " . count($data) . " items, maximum is {$schema['maxItems']}";
        }
    }

    private static function validateString(mixed $data, array $schema, string $path, array &$errors): void
    {
        if (!is_string($data)) {
            $errors[] = "{$path}: expected string, got " . gettype($data);
        }
    }

    private static function validateInteger(mixed $data, array $schema, string $path, array &$errors): void
    {
        if (!is_int($data)) {
            $errors[] = "{$path}: expected integer, got " . gettype($data);
        }
    }

    private static function validateNumber(mixed $data, array $schema, string $path, array &$errors): void
    {
        if (!is_numeric($data)) {
            $errors[] = "{$path}: expected number, got " . gettype($data);
        }
    }
}
```

当 LLM 返回的 JSON 不符合 schema 时，有些 Provider 实现（如 OpenAI 的 Structured Outputs 功能）可以在 API 层面保证返回结果的 schema 合规性。对于不支持原生 schema 约束的供应商，我们可以在客户端侧使用验证器进行校验，如果校验失败则重试请求。

---

## 七、Laravel 集成

### 7.1 Service Provider

Laravel 的 Service Provider 是注册 SDK 组件的最佳位置。它负责从配置文件读取供应商配置、创建 Provider 实例、注册到容器中。

```php
<?php

namespace AISdk\Laravel;

use Illuminate\Support\ServiceProvider;
use AISdk\AI;
use AISdk\Tools\ToolRunner;
use AISdk\Providers\{OpenAIProvider, AnthropicProvider, OllamaProvider};

class AISdkServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 合并默认配置
        $this->mergeConfigFrom(
            __DIR__ . '/../../config/ai-sdk.php', 'ai-sdk'
        );

        // 注册 AI 管理器为单例
        $this->app->singleton('ai-sdk', function ($app) {
            $config = $app['config']['ai-sdk'];
            return $this->createAIManager($config);
        });

        // 注册 ToolRunner 为单例（工具在应用生命周期内复用）
        $this->app->singleton(ToolRunner::class, function ($app) {
            $runner = new ToolRunner();
            // 注册配置文件中定义的工具
            foreach ($app['config']['ai-sdk']['tools'] ?? [] as $toolConfig) {
                if (is_callable($toolConfig)) {
                    $runner->addTool($toolConfig());
                }
            }
            return $runner;
        });

        // 别名注册
        $this->app->alias('ai-sdk', AIManager::class);
    }

    public function boot(): void
    {
        // 发布配置文件
        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__ . '/../../config/ai-sdk.php' => config_path('ai-sdk.php'),
            ], 'ai-sdk-config');
        }
    }

    private function createAIManager(array $config): AIManager
    {
        // 注册 OpenAI
        if ($apiKey = data_get($config, 'providers.openai.api_key')) {
            AI::provider('openai', new OpenAIProvider(
                apiKey:  $apiKey,
                baseUrl: data_get($config, 'providers.openai.base_url', 'https://api.openai.com/v1'),
            ));
        }

        // 注册 Anthropic
        if ($apiKey = data_get($config, 'providers.anthropic.api_key')) {
            AI::provider('anthropic', new AnthropicProvider(
                apiKey: $apiKey,
            ));
        }

        // 注册 Ollama（本地推理）
        if (data_get($config, 'providers.ollama.enabled', false)) {
            AI::provider('ollama', new OllamaProvider(
                baseUrl: data_get($config, 'providers.ollama.url', 'http://localhost:11434'),
            ));
        }

        // 设置默认供应商
        AI::default($config['default_provider'] ?? 'openai');

        return new AIManager($config);
    }
}
```

### 7.2 Facade

Facade 让调用方式更加符合 Laravel 开发者的习惯。

```php
<?php

namespace AISdk\Laravel;

use Illuminate\Support\Facades\Facade;

/**
 * @method static \AISdk\Results\GenerateResult generateText(string $prompt, array $options = [])
 * @method static \AISdk\Streaming\StreamResponse streamText(string $prompt, array $options = [])
 * @method static \AISdk\Results\ObjectResult generateObject(string $prompt, array $schema, array $options = [])
 *
 * @see \AISdk\Laravel\AIManager
 */
class AIFacade extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'ai-sdk';
    }
}
```

在 `config/app.php` 中注册后，就可以这样使用：

```php
use AISdk\Laravel\AIFacade as AI;

// 同步调用
$response = AI::generateText('解释 PHP 8.4 的新特性', [
    'model' => 'gpt-4o',
]);

// 流式调用
$stream = AI::streamText('写一篇关于 Laravel 12 的技术博客', [
    'provider' => 'anthropic',
    'model'    => 'claude-sonnet-4-20250514',
]);
```

### 7.3 流式端点中间件

这个中间件自动为流式响应设置正确的 HTTP 头，避免开发者在每个控制器中重复编写这些头信息。

```php
<?php

namespace AISdk\Laravel\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class EnsureStreamHeaders
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        if ($response instanceof StreamedResponse) {
            $response->headers->set('X-Accel-Buffering', 'no');
            $response->headers->set('Cache-Control', 'no-cache, no-store, must-revalidate');
            $response->headers->set('Connection', 'keep-alive');
            $response->headers->set('X-Accel-Charset', 'utf-8');
        }

        return $response;
    }
}
```

---

## 八、性能优化

### 8.1 连接池与 HTTP 客户端复用

在高并发场景下，为每个请求创建新的 Guzzle HTTP 客户端会导致 TCP 连接建立和 TLS 握手的开销。通过共享同一个 HTTP 客户端实例，并使用 cURL Multi Handler，可以显著减少网络开销。在 Laravel Octane 环境下这一点尤为重要，因为 Octane 保持 worker 进程常驻，连接复用的效果更加显著。

```php
<?php

namespace AISdk\Http;

use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Handler\CurlMultiHandler;

class SharedHttpClient
{
    private static ?Client $instance = null;

    public static function getInstance(): Client
    {
        if (self::$instance === null) {
            $handler = HandlerStack::create(new CurlMultiHandler());

            self::$instance = new Client([
                'handler'         => $handler,
                'timeout'         => 120,
                'connect_timeout' => 15,
                'http_errors'     => false,
                'curl'            => [
                    CURLOPT_TCP_KEEPALIVE  => 1,    // 启用 TCP Keep-Alive
                    CURLOPT_TCP_KEEPIDLE   => 30,   // 空闲 30 秒后发送探测包
                    CURLOPT_TCP_KEEPINTVL  => 10,   // 探测包间隔 10 秒
                    CURLOPT_MAXCONNECTS    => 50,   // 最大并发连接数
                    CURLOPT_FORBID_REUSE   => 0,    // 允许连接复用
                ],
            ]);
        }

        return self::$instance;
    }

    /**
     * 重置客户端（用于测试或配置变更后）
     */
    public static function reset(): void
    {
        self::$instance = null;
    }
}
```

### 8.2 指数退避重试策略

LLM API 的速率限制和暂时性错误（429 Too Many Requests、5xx 服务端错误）是常见的问题。一个健壮的重试策略对于生产环境至关重要。

```php
<?php

namespace AISdk\Retry;

use GuzzleHttp\Exception\{ConnectException, RequestException};

class RetryPolicy
{
    public function __construct(
        private int $maxAttempts = 3,
        private int $baseDelayMs = 1000,
        private float $backoffMultiplier = 2.0,
        private float $jitterFactor = 0.3,
    ) {}

    /**
     * 带重试的执行包装
     */
    public function execute(callable $operation): mixed
    {
        $lastException = null;

        for ($attempt = 0; $attempt < $this->maxAttempts; $attempt++) {
            try {
                return $operation();
            } catch (\Exception $e) {
                $lastException = $e;

                if (!$this->isRetryable($e)) {
                    throw $e;
                }

                // 计算退避延迟（指数退避 + 随机抖动）
                $delay = $this->baseDelayMs * pow($this->backoffMultiplier, $attempt);
                $jitter = $delay * $this->jitterFactor * (mt_rand() / mt_getrandmax());
                $totalDelay = (int) ($delay + $jitter);

                \Log::warning("AI SDK request failed (attempt {$attempt}/{$this->maxAttempts}), "
                    . "retrying in {$totalDelay}ms", [
                        'error'   => $e->getMessage(),
                        'attempt' => $attempt + 1,
                    ]);

                usleep($totalDelay * 1000);
            }
        }

        throw $lastException;
    }

    /**
     * 判断错误是否可重试
     */
    private function isRetryable(\Exception $e): bool
    {
        // 连接超时
        if ($e instanceof ConnectException) {
            return true;
        }

        // HTTP 状态码相关的重试判断
        if ($e instanceof RequestException && $e->hasResponse()) {
            $status = $e->getResponse()->getStatusCode();
            return in_array($status, [429, 500, 502, 503, 504]);
        }

        return false;
    }
}
```

### 8.3 Token 计数

Token 数量直接影响 API 调用的成本和延迟。在工具调用场景中，工具定义本身会消耗大量 input tokens（每个工具的 schema 可能占 200-500 tokens），如果注册了过多工具，可能在发送用户消息之前就用掉了大部分上下文窗口。

```php
<?php

namespace AISdk\Tokens;

/**
 * Token 数量估算器
 * 基于经验规则的快速估算，适合成本预算和上下文窗口管理
 *
 * 对于精确计算，建议使用专门的 tokenizer 库（如 yethee/tiktoken）
 */
class TokenCounter
{
    /**
     * 估算文本的 token 数量
     * 规则：中文约 1.5 token/字，英文约 0.75 token/词，代码约 0.4 token/字符
     */
    public static function estimate(string $text, string $model = 'gpt-4o'): int
    {
        $chineseChars = mb_strlen(preg_replace('/[^\x{4e00}-\x{9fff}]/u', '', $text));
        $totalChars = mb_strlen($text);
        $otherChars = $totalChars - $chineseChars;

        return (int) ceil($chineseChars * 1.5 + $otherChars * 0.4);
    }

    /**
     * 估算消息数组的总 token 数
     * 每条消息有约 4 token 的格式开销（role、分隔符等）
     */
    public static function estimateMessages(array $messages, string $model = 'gpt-4o'): int
    {
        $total = 0;
        foreach ($messages as $msg) {
            $total += 4; // 格式开销
            $total += self::estimate($msg->content ?? '', $model);
        }
        $total += 2; // 对话结束标记
        return $total;
    }

    /**
     * 估算工具定义占用的 token 数
     */
    public static function estimateTools(array $tools): int
    {
        $total = 0;
        foreach ($tools as $tool) {
            // 工具的 schema 定义通常较长
            $total += self::estimate(json_encode($tool->parameters));
            $total += self::estimate($tool->name . ' ' . $tool->description);
            $total += 10; // 格式开销
        }
        return $total;
    }
}
```

---

## 九、与现有 PHP AI 库的对比

### 9.1 设计理念的差异

现有的 PHP AI 库（如 `openai-php/client` 和 `orhanerday/open-ai`）本质上是**客户端封装**——它们的定位是简化某个特定 API 的调用方式，提供类型安全和错误处理。这些库做得很好，但它们解决的是不同层次的问题。

AI SDK for PHP 的定位是**抽象层**——它在客户端封装之上增加了一层供应商无关的抽象，使应用代码与具体供应商解耦。这类似于 PDO 之于 MySQLi 的关系：PDO 不是更好的 MySQL 客户端，而是数据库无关的抽象层。

这两种方案并不矛盾。在实际项目中，你可以使用 `openai-php/client` 作为底层传输层，然后在其之上构建 AI SDK 的 Provider 实现。事实上，对于已有的成熟封装库，复用它们作为底层实现比从头重写 HTTP 调用更加合理。

### 9.2 功能覆盖对比

从功能维度看，AI SDK for PHP 相比现有库增加了以下关键能力：

**多供应商支持**是最核心的差异。一个接口即可在 OpenAI、Anthropic、Gemini、Ollama 之间切换，甚至可以在运行时根据价格和延迟动态选择供应商。

**多步工具调用编排**是另一个重要能力。现有的单供应商库虽然支持工具调用的单次请求-响应，但缺乏内置的多轮编排逻辑。AI SDK 的 ToolRunner 自动管理消息历史的累积和工具结果的回传，开发者只需定义工具和对话，无需手动管理循环。

**结构化输出**提供了从 LLM 获取严格格式化数据的能力，配合 Schema 验证器确保数据的可靠性。这在构建数据提取管道或 API 网关时特别有用。

**内置的 Token 计数和重试策略**覆盖了生产环境中的常见需求，避免开发者重复造轮子。

### 9.3 代码简洁度对比

使用 `openai-php/client` 调用 OpenAI（单供应商场景下的最优选择）：

```php
// openai-php/client - 优秀的单供应商封装
$client = OpenAI::client(env('OPENAI_API_KEY'));

$response = $client->chat()->create([
    'model'    => 'gpt-4o',
    'messages' => [
        ['role' => 'system', 'content' => '你是一个技术助手。'],
        ['role' => 'user',   'content' => 'PHP 8.4 有什么新特性？'],
    ],
]);

echo $response->choices[0]->message->content;
```

使用 AI SDK for PHP（多供应商场景下的抽象方案）：

```php
// AI SDK for PHP - 供应商可切换
$result = AI::generateText('PHP 8.4 有什么新特性？', [
    'provider' => 'openai',       // 改成 'anthropic' 即切换
    'model'    => 'gpt-4o',
    'system'   => '你是一个技术助手。',
]);

echo $result->text;
```

对于只使用 OpenAI 一个供应商的简单项目，`openai-php/client` 可能是更轻量的选择。但一旦涉及多供应商、工具调用编排、结构化输出等需求，AI SDK 的优势就会显现出来。

---

## 十、实战：构建完整的聊天 API

将前面的所有组件整合在一起，我们来构建一个完整的聊天 API 端点，支持流式输出和工具调用。

### 10.1 路由定义

```php
<?php

// routes/api.php
use App\Http\Controllers\ChatController;

Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::post('/chat', [ChatController::class, 'chat']);
    Route::post('/chat/stream', [ChatController::class, 'streamChat']);
    Route::get('/chat/providers', [ChatController::class, 'providers']);
});
```

### 10.2 请求验证

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ChatRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'message'         => 'required|string|max:8192',
            'provider'        => 'sometimes|string|in:openai,anthropic,ollama',
            'model'           => 'sometimes|string|max:100',
            'system_prompt'   => 'sometimes|string|max:4096',
            'history'         => 'sometimes|array|max:50',
            'history.*.role'  => 'required_with:history|in:user,assistant',
            'history.*.content' => 'required_with:history|string|max:8192',
            'max_tokens'      => 'sometimes|integer|min:1|max:8192',
            'temperature'     => 'sometimes|numeric|min:0|max:2',
            'enable_tools'    => 'sometimes|boolean',
        ];
    }
}
```

### 10.3 控制器实现

```php
<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChatRequest;
use AISdk\AI;
use AISdk\Laravel\AIFacade;
use AISdk\Messages\{SystemMessage, UserMessage, AssistantMessage};
use AISdk\Options\GenerateOptions;
use AISdk\Tools\{Tool, ToolRunner};

class ChatController extends Controller
{
    private ToolRunner $runner;

    public function __construct(ToolRunner $runner)
    {
        $this->runner = $runner;
        $this->registerTools();
    }

    private function registerTools(): void
    {
        $this->runner->addTool(Tool::define([
            'name'        => 'get_current_time',
            'description' => '获取当前日期和时间',
            'parameters'  => ['type' => 'object', 'properties' => [
                'timezone' => ['type' => 'string', 'description' => '时区，如 Asia/Shanghai'],
            ], 'required' => ['timezone']],
            'execute' => fn(array $args) => json_encode([
                'datetime' => now()->setTimezone($args['timezone'])->toDateTimeString(),
                'timezone' => $args['timezone'],
            ]),
        ]));
    }

    /**
     * 非流式聊天
     */
    public function chat(ChatRequest $request)
    {
        $messages = $this->buildMessages($request);

        $options = new GenerateOptions(
            model: $request->input('model', 'gpt-4o'),
            maxTokens: $request->input('max_tokens', 2048),
            temperature: $request->input('temperature', 0.7),
        );

        $provider = AI::getProvider($request->input('provider', 'openai'));

        // 如果启用工具，使用 ToolRunner
        if ($request->boolean('enable_tools', true)) {
            $result = $this->runner->runWithTools(
                $provider, $messages, $options, maxSteps: 3
            );
        } else {
            $result = $provider->generateText($messages, $options);
        }

        return response()->json([
            'success'  => true,
            'message'  => $result->text,
            'usage'    => [
                'prompt_tokens'     => $result->usage->promptTokens,
                'completion_tokens' => $result->usage->completionTokens,
                'total_tokens'      => $result->usage->total(),
            ],
            'provider' => $request->input('provider', 'openai'),
            'model'    => $request->input('model', 'gpt-4o'),
        ]);
    }

    /**
     * 流式聊天
     */
    public function streamChat(ChatRequest $request)
    {
        $messages = $this->buildMessages($request);

        return response()->stream(function () use ($messages, $request) {
            try {
                $stream = AI::streamText($messages, [
                    'provider'  => $request->input('provider', 'openai'),
                    'model'     => $request->input('model', 'gpt-4o'),
                    'maxTokens' => $request->input('max_tokens', 2048),
                    'system'    => $request->input('system_prompt', '你是一个专业的技术助手。'),
                ]);

                foreach ($stream as $chunk) {
                    if (!empty($chunk->text)) {
                        $this->sendEvent('text', ['text' => $chunk->text]);
                    }
                    if ($chunk->finishReason) {
                        $this->sendEvent('done', ['reason' => $chunk->finishReason]);
                        break;
                    }
                }
            } catch (\Throwable $e) {
                $this->sendEvent('error', [
                    'message' => app()->isProduction() ? '服务暂时不可用' : $e->getMessage(),
                ]);
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 获取可用的供应商和模型列表
     */
    public function providers()
    {
        return response()->json([
            'providers' => [
                'openai'    => ['models' => ['gpt-4o', 'gpt-4o-mini', 'o3-mini']],
                'anthropic' => ['models' => ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514']],
                'ollama'    => ['models' => ['llama3', 'mistral', 'codellama']],
            ],
        ]);
    }

    private function buildMessages(ChatRequest $request): array
    {
        $messages = [];

        // 系统提示
        $messages[] = new SystemMessage(
            $request->input('system_prompt', '你是一个专业的技术助手，擅长用简洁清晰的中文回答问题。')
        );

        // 对话历史
        foreach ($request->input('history', []) as $item) {
            $messages[] = match ($item['role']) {
                'user'      => new UserMessage($item['content']),
                'assistant' => new AssistantMessage($item['content']),
            };
        }

        // 当前用户消息
        $messages[] = new UserMessage($request->input('message'));

        return $messages;
    }

    private function sendEvent(string $event, array $data): void
    {
        echo "event: {$event}\ndata: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
        if (ob_get_level() > 0) ob_flush();
        flush();
    }
}
```

### 10.4 前端对接示例

```javascript
/**
 * 流式聊天前端调用示例
 * 使用 fetch + ReadableStream 消费 SSE
 */
async function chatStream(message, onChunk, onDone) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify({
      message,
      provider: 'openai',
      model: 'gpt-4o',
      enable_tools: true,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop(); // 保留未完成的事件

    for (const event of events) {
      const lines = event.split('\n');
      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        if (line.startsWith('data: ')) eventData = line.slice(6);
      }

      if (eventType === 'text' && eventData) {
        const { text } = JSON.parse(eventData);
        onChunk(text); // 逐字追加到 UI
      }

      if (eventType === 'done') {
        const data = JSON.parse(eventData);
        onDone(data.reason);
      }

      if (eventType === 'error') {
        const data = JSON.parse(eventData);
        console.error('Chat error:', data.message);
      }
    }
  }
}

// 使用示例
const chatDiv = document.getElementById('chat-response');
chatDiv.textContent = '';

await chatStream(
  '用 PHP 实现一个简单的 Redis 缓存封装',
  (text) => { chatDiv.textContent += text; },
  (reason) => { console.log('Stream finished:', reason); }
);
```

---

## 总结

本文从零开始构建了一个对标 Vercel AI SDK 的 PHP 版本——**AI SDK for PHP**。让我们回顾整个方案的核心要点：

**架构层面**，我们采用了四层架构设计——Facade 层提供简洁的调用入口，核心层包含消息构建、流式解析、工具编排等通用组件，供应商层通过接口隔离各 LLM 的 API 差异，传输层基于 Guzzle 实现 HTTP 通信。这种分层确保了每一层的职责清晰，也方便后续扩展新的供应商。

**功能层面**，我们实现了统一的 LLM 调用接口（`generateText`/`streamText`/`generateObject`）、基于 SSE 的流式响应、多步工具调用编排（`ToolRunner`）、JSON Schema 验证的结构化输出、以及完整的 Laravel 集成（Service Provider、Facade、Middleware）。

**工程层面**，我们覆盖了生产环境必须考虑的连接池优化、指数退避重试、Token 计数估算等性能和可靠性措施。

**生态层面**，我们与现有的 PHP AI 库进行了对比，明确了 AI SDK 的定位——它不是替代 `openai-php/client`，而是在其之上提供了一层供应商无关的抽象。对于只使用单一供应商的简单项目，直接使用原生封装库可能更轻量；但对于需要多供应商切换、工具编排、结构化输出的复杂应用，AI SDK 的价值会非常显著。

最后，PHP 在 AI 应用开发领域的潜力远比大多数人想象的要大。Laravel 的 Eloquent 可以直接作为工具的数据层，Livewire 可以配合流式 API 实现服务端渲染的实时 UI，Laravel Octane 的常驻进程模型天然适合连接池和缓存复用，Laravel Queue 可以将耗时的 AI 调用异步化。PHP 社区完全有能力构建出一流的 AI 应用开发体验，关键在于有人迈出第一步搭建基础设施。

---

> **声明：** 本文代码示例中的 `AISdk` 包名为教学演示用途，架构设计和代码逻辑可直接用于实际项目开发。截至 2026 年 6 月，PHP 社区中类似的 AI SDK 抽象层项目正在快速发展中，建议关注 GitHub 上的最新进展。如果你有兴趣参与构建 PHP AI SDK 生态，欢迎在评论区留言交流。

---

## 相关阅读

- [Laravel Boost 实战：AI 驱动的 Laravel 开发加速](/categories/Laravel-PHP/Laravel-Boost-实战-AI驱动的Laravel开发加速/)
- [OpenClaw 与 Laravel 集成：在 PHP 项目中调用 AI Agent 能力](/categories/Laravel-PHP/OpenClaw-与-Laravel-集成-在PHP项目中调用AI-Agent能力/)
- [AI Agent Code Interpreter 沙箱化代码执行：Docker 与 Firecracker 方案](/categories/架构/AI-Agent-Code-Interpreter-沙箱化代码执行-Docker-Firecracker-方案/)
