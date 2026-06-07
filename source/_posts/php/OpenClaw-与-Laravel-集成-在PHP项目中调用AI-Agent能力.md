---
title: OpenClaw 与 Laravel 集成：在 PHP 项目中调用 AI Agent 能力
date: 2026-06-02 00:00:00
description: 本文系统讲透 OpenClaw 与 Laravel 在 PHP 项目中的 AI Agent 集成方案，覆盖 Service Provider 封装、队列异步调用、结构化结果落库、错误重试、幂等治理与生产部署要点，帮助你把一次性模型调用升级为可维护、可观测、可扩展的企业级 AI 能力。
tags: [OpenClaw, Laravel, PHP, AI-Agent, 集成]
categories: [Laravel/PHP]
cover: /images/covers/openclaw-laravel-cover.jpg
---

在过去几年里，Laravel 项目接入 AI 的方式，大多还停留在“把一个 prompt 发给模型接口，再把返回文本展示出来”的初级阶段。这样的集成方式当然有价值，但它和真正意义上的 **AI Agent 能力** 之间，仍然存在明显差距。一个 Agent 不只是生成文本，它还意味着任务分解、上下文记忆、工具调用、结构化输出、重试控制、异步执行以及与业务系统深度耦合后的可运营能力。

对于 PHP 团队而言，尤其是以 Laravel 为核心框架的中大型项目，问题不在于“能不能调用一个大模型”，而在于：**如何以 Laravel 的方式，把 Agent 能力纳入现有应用架构、队列体系、数据库模型、监控告警和部署流程中**。OpenClaw 的价值，就体现在它不是一个只会吐文本的简单接口，而是一套更偏 Agent Runtime 的能力封装。把它接进 Laravel 后，才能真正构建“可追踪、可重放、可治理”的 AI 工作流。

这篇文章会从工程化视角，完整讲解如何在 Laravel 中集成 OpenClaw，并把它包装成你团队可以长期维护的基础设施能力。文章覆盖以下内容：

1. 为什么 Laravel 项目需要 AI Agent
2. OpenClaw API / SDK 的能力边界与适配思路
3. 使用 Laravel Service Provider 进行统一封装
4. 基于 HTTP 调用与异步队列的集成模式
5. Agent 返回结果的结构化处理与 Eloquent 存储
6. 错误处理、重试、幂等和熔断策略
7. 性能优化、成本控制与生产环境部署注意事项

同时，文中会提供较完整的代码示例，并结合真实工程经验总结一些常见踩坑点。

---

# 一、为什么 Laravel 项目需要 AI Agent

## 1.1 从“调用模型”到“调用能力”

很多 Laravel 项目初次接入 AI，通常都是下面这种模式：

```php
$response = Http::withToken(config('services.llm.key'))
    ->post('https://api.example.com/v1/chat/completions', [
        'model' => 'gpt-4.1',
        'messages' => [
            ['role' => 'user', 'content' => '帮我总结这篇文章'],
        ],
    ])
    ->json();
```

这段代码本身没有问题，但它存在几个天然局限：

- 只适合一次性文本生成
- 上下文管理完全靠业务代码拼接
- 缺少统一的错误分类与重试策略
- 结果往往是非结构化文本，不便落库和后续编排
- 无法很好地接入队列、审计、回放和任务追踪
- 当 AI 需要工具调用、工作流分步骤执行时，代码会迅速失控

换句话说，这种做法只是“调用一个模型接口”，不是“把 AI 作为系统能力引入”。

而 Agent 化之后，Laravel 项目里会出现更多典型场景：

- 电商后台自动生成商品卖点、FAQ、客服回复建议
- CRM 系统根据客户互动记录做跟进摘要和机会识别
- 内容平台自动做文章标签提取、SEO 摘要、敏感内容校验
- 内部知识库系统支持问答、工单路由、 SOP 推荐
- 运营系统批量执行数据分析、文本清洗和结构化抽取

这些场景有一个共同点：它们不是单次问答，而是 **受业务规则驱动的任务执行**。Laravel 作为一个成熟的 Web 应用框架，本身就已经提供了：

- IOC 容器
- 配置系统
- 队列系统
- 事件广播
- Eloquent ORM
- 日志与异常处理
- 调度器
- 缓存、锁与限流

所以 Laravel 实际上非常适合承载 AI Agent，只要我们把 Agent 能力包装成“符合 Laravel 习惯的服务”。

## 1.2 AI Agent 在传统 PHP 系统中的意义

很多人一听“Agent”，容易联想到复杂自治系统，但放到企业应用里，Agent 的核心价值更务实：

### 第一，统一复杂调用过程

比如你要做一个“合同内容审查”功能，用户上传合同后，系统需要：

1. 提取文本
2. 分段切分
3. 调用 AI 识别风险条款
4. 输出结构化风险项
5. 按风险等级入库
6. 异步生成审查报告

如果全写在 Controller 里，会非常混乱。Agent Runtime 可以把“任务请求”和“任务结果”标准化，让流程更稳定。

### 第二，让异步化更自然

Laravel 队列本来就适合处理耗时任务。AI 调用天然具有高延迟、不稳定和成本较高等特征，非常适合放到 Job 中异步执行。Agent 化后，可以更清晰地区分：

- 任务入队
- 状态流转
- 调用执行
- 回调处理
- 补偿重试

### 第三，便于做治理

生产环境接入 AI 以后，真正难的从来不是第一天跑通，而是后续治理：

- 哪些请求失败率高？
- 哪些用户触发了高成本任务？
- 某个结果为什么是这个样子？
- 是否能重放某次请求？
- Prompt 版本是否可追踪？
- 输出结构变化后旧数据怎么兼容？

这些都要求你把 AI 任务当成正式业务能力，而不是一个临时 HTTP 调用。

## 1.3 为什么选择 OpenClaw 这一类 Agent API

从工程角度看，OpenClaw 这类能力层适合 Laravel 的原因主要有三点：

1. **抽象层级更高**：比直接对接底层模型 API 更接近“Agent 任务”语义。
2. **可扩展性更好**：后续如果需要切换模型、引入工具调用、补充工作流节点，侵入业务代码的成本更低。
3. **便于封装统一客户端**：可以在 Laravel 中做成单一入口服务，避免团队每个人各写一套调用逻辑。

因此，我们这篇文章的核心目标并不是“把 OpenClaw API 调通”，而是：**设计一套 Laravel 友好的 OpenClaw 集成方案**。

---

# 二、OpenClaw API / SDK 概述

> 说明：不同版本的 OpenClaw 在实际字段命名上可能略有差异。本文重点放在 Laravel 集成模式与工程封装方式上，因此示例会采用一套清晰、稳定、可落地的通用 API 设计。

## 2.1 我们需要的最小能力集合

站在 Laravel 项目集成方视角，一套可用的 Agent API 至少应该支持：

- 创建任务 / 发起推理请求
- 传入上下文、系统提示词、工具配置
- 返回 request_id / task_id / trace_id
- 查询任务状态
- 返回结构化结果
- 提供错误码和重试语义
- 支持同步或异步模式

一个典型请求可以抽象成：

```json
{
  "agent": "content-analyzer",
  "input": {
    "title": "Laravel 11 发布说明",
    "body": "这里是一段较长的文章正文..."
  },
  "context": {
    "tenant_id": 1001,
    "user_id": 9527,
    "scene": "article_summary"
  },
  "options": {
    "temperature": 0.2,
    "timeout": 30,
    "response_format": "json"
  },
  "metadata": {
    "request_id": "req_202606020001",
    "source": "laravel-backend"
  }
}
```

返回值可能类似：

```json
{
  "id": "agt_01JXYZ...",
  "status": "completed",
  "trace_id": "trace_abc123",
  "output": {
    "summary": "本文介绍了 Laravel 11 的新特性...",
    "keywords": ["Laravel", "PHP", "框架升级"],
    "risk_level": "low"
  },
  "usage": {
    "input_tokens": 1250,
    "output_tokens": 240
  },
  "latency_ms": 3860
}
```

如果是异步模式，第一次提交可能只返回：

```json
{
  "id": "agt_01JXYZ...",
  "status": "queued",
  "trace_id": "trace_abc123"
}
```

后续通过查询接口或回调获取最终结果。

## 2.2 在 Laravel 中不要直接把第三方响应暴露给业务层

这是一个非常重要的原则。很多团队集成第三方 API 时，会直接在业务代码里写：

```php
$result = $client->post('/v1/agents/run', $payload);
if ($result['status'] === 'completed') {
    return $result['output']['summary'];
}
```

这么做短期看很快，长期却很危险，因为：

- 第三方字段可能变更
- 多个场景的输出结构不同，业务层会被迫知道太多细节
- 错误码处理不统一
- 后续要切换供应商时替换成本极高

更好的方式是，在 Laravel 内部定义 **领域级 DTO 或 Value Object**，例如：

```php
namespace App\AI\Data;

class AgentResponseData
{
    public function __construct(
        public readonly string $id,
        public readonly string $status,
        public readonly ?string $traceId,
        public readonly ?array $output,
        public readonly ?array $usage,
        public readonly ?int $latencyMs,
        public readonly ?array $raw = null,
    ) {}

    public function isCompleted(): bool
    {
        return $this->status === 'completed';
    }

    public function isQueued(): bool
    {
        return in_array($this->status, ['queued', 'processing'], true);
    }
}
```

这样第三方 API 与业务逻辑之间就会有一层稳定的“防腐层”。

## 2.3 SDK 与纯 HTTP 的取舍

如果 OpenClaw 官方提供 PHP SDK，通常你会面临一个选择：

- 直接使用 SDK
- 只用 HTTP API，自行封装 Laravel Client

我的建议是：

### 当 SDK 足够成熟时

可以基于 SDK 再包一层适配器，而不是让 Controller / Job 直接调用 SDK。

### 当 SDK 不成熟或字段波动频繁时

直接使用 Laravel HTTP Client（底层 Guzzle）往往更可控，因为：

- 更容易统一超时、重试、日志和 tracing
- 更方便与 Laravel 配置系统结合
- 更利于 mock 和测试
- 对响应结构的掌控更强

尤其在企业项目中，**“可控”通常比“少写几行代码”更重要**。

下面我们会采用 Laravel 原生 HTTP Client 封装一个 OpenClaw 客户端，这样适配面最广。

---

# 三、Laravel Service Provider 封装

## 3.1 目标：把 OpenClaw 变成 Laravel 的基础服务

我们希望最终业务层可以这样用：

```php
$agent = app(\App\AI\Contracts\AgentManagerInterface::class);

$response = $agent->run('content-analyzer', [
    'title' => $article->title,
    'body' => $article->content,
], [
    'scene' => 'seo_summary',
    'user_id' => auth()->id(),
]);
```

而不是在每个地方重复：

- 拼 URL
- 设置 token
- 配置 timeout
- 写 try/catch
- 解析 JSON
- 处理错误码

所以第一步是做配置文件和 Service Provider。

## 3.2 配置文件设计

新建 `config/openclaw.php`：

```php
<?php

return [
    'base_url' => env('OPENCLAW_BASE_URL', 'https://api.openclaw.example'),
    'api_key' => env('OPENCLAW_API_KEY'),
    'timeout' => (int) env('OPENCLAW_TIMEOUT', 30),
    'connect_timeout' => (int) env('OPENCLAW_CONNECT_TIMEOUT', 5),
    'retry_times' => (int) env('OPENCLAW_RETRY_TIMES', 2),
    'retry_sleep_ms' => (int) env('OPENCLAW_RETRY_SLEEP_MS', 300),
    'default_agent' => env('OPENCLAW_DEFAULT_AGENT', 'general-assistant'),
    'async_poll_interval' => (int) env('OPENCLAW_ASYNC_POLL_INTERVAL', 10),
    'webhook_secret' => env('OPENCLAW_WEBHOOK_SECRET'),
    'log_channel' => env('OPENCLAW_LOG_CHANNEL', 'stack'),
];
```

`.env` 中对应增加：

```dotenv
OPENCLAW_BASE_URL=https://api.openclaw.example
OPENCLAW_API_KEY=your-api-key
OPENCLAW_TIMEOUT=30
OPENCLAW_CONNECT_TIMEOUT=5
OPENCLAW_RETRY_TIMES=2
OPENCLAW_RETRY_SLEEP_MS=300
OPENCLAW_DEFAULT_AGENT=general-assistant
OPENCLAW_ASYNC_POLL_INTERVAL=10
OPENCLAW_WEBHOOK_SECRET=your-webhook-secret
OPENCLAW_LOG_CHANNEL=stack
```

这里的配置有几个关键点：

- `connect_timeout` 与 `timeout` 分开配置，避免网络抖动拖垮 PHP Worker
- `retry_times` 只用于网络级或可重试错误，不能无脑重试所有失败
- `webhook_secret` 用于校验回调安全性
- `log_channel` 独立出来，方便把 AI 相关日志分流到单独文件或日志平台

## 3.3 定义契约接口

先定义一个统一接口 `app/AI/Contracts/AgentManagerInterface.php`：

```php
<?php

namespace App\AI\Contracts;

use App\AI\Data\AgentResponseData;

interface AgentManagerInterface
{
    public function run(string $agent, array $input, array $context = [], array $options = []): AgentResponseData;

    public function dispatch(string $agent, array $input, array $context = [], array $options = []): AgentResponseData;

    public function retrieve(string $taskId): AgentResponseData;
}
```

这里我们刻意拆成三类动作：

- `run`：同步执行，适合简单低延迟任务
- `dispatch`：异步投递，适合批量、耗时、高成本任务
- `retrieve`：查询任务状态或结果

## 3.4 DTO 定义

`app/AI/Data/AgentResponseData.php`：

```php
<?php

namespace App\AI\Data;

class AgentResponseData
{
    public function __construct(
        public readonly string $id,
        public readonly string $status,
        public readonly ?string $traceId = null,
        public readonly ?array $output = null,
        public readonly ?array $usage = null,
        public readonly ?int $latencyMs = null,
        public readonly ?string $errorCode = null,
        public readonly ?string $errorMessage = null,
        public readonly ?array $raw = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: (string) ($data['id'] ?? ''),
            status: (string) ($data['status'] ?? 'unknown'),
            traceId: $data['trace_id'] ?? null,
            output: $data['output'] ?? null,
            usage: $data['usage'] ?? null,
            latencyMs: isset($data['latency_ms']) ? (int) $data['latency_ms'] : null,
            errorCode: $data['error']['code'] ?? null,
            errorMessage: $data['error']['message'] ?? null,
            raw: $data,
        );
    }

    public function isCompleted(): bool
    {
        return $this->status === 'completed';
    }

    public function isFailed(): bool
    {
        return $this->status === 'failed';
    }

    public function isPending(): bool
    {
        return in_array($this->status, ['queued', 'processing', 'pending'], true);
    }
}
```

## 3.5 异常体系设计

很多人会偷懒直接 `throw new \Exception()`，但 AI 集成里错误类型很多，不分类会让重试策略变得很糟糕。

建议建立至少这几类异常：

`app/AI/Exceptions/AgentException.php`

```php
<?php

namespace App\AI\Exceptions;

use RuntimeException;

class AgentException extends RuntimeException
{
}
```

`app/AI/Exceptions/AgentAuthenticationException.php`

```php
<?php

namespace App\AI\Exceptions;

class AgentAuthenticationException extends AgentException
{
}
```

`app/AI/Exceptions/AgentRateLimitException.php`

```php
<?php

namespace App\AI\Exceptions;

class AgentRateLimitException extends AgentException
{
}
```

`app/AI/Exceptions/AgentRemoteException.php`

```php
<?php

namespace App\AI\Exceptions;

class AgentRemoteException extends AgentException
{
}
```

`app/AI/Exceptions/AgentTimeoutException.php`

```php
<?php

namespace App\AI\Exceptions;

class AgentTimeoutException extends AgentException
{
}
```

这一步非常关键，因为后面队列 Job 的 `backoff()` 和 `failed()` 方法会依赖这些异常类型做差异化处理。

## 3.6 OpenClawClient 封装

`app/AI/OpenClawClient.php`：

```php
<?php

namespace App\AI;

use App\AI\Data\AgentResponseData;
use App\AI\Exceptions\AgentAuthenticationException;
use App\AI\Exceptions\AgentRateLimitException;
use App\AI\Exceptions\AgentRemoteException;
use App\AI\Exceptions\AgentTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class OpenClawClient
{
    public function __construct(
        protected string $baseUrl,
        protected string $apiKey,
        protected int $timeout,
        protected int $connectTimeout,
        protected int $retryTimes,
        protected int $retrySleepMs,
        protected ?string $logChannel = null,
    ) {}

    public function run(string $agent, array $input, array $context = [], array $options = []): AgentResponseData
    {
        $payload = $this->buildPayload($agent, $input, $context, $options + ['mode' => 'sync']);
        $data = $this->post('/v1/agents/run', $payload);

        return AgentResponseData::fromArray($data);
    }

    public function dispatch(string $agent, array $input, array $context = [], array $options = []): AgentResponseData
    {
        $payload = $this->buildPayload($agent, $input, $context, $options + ['mode' => 'async']);
        $data = $this->post('/v1/agents/run', $payload);

        return AgentResponseData::fromArray($data);
    }

    public function retrieve(string $taskId): AgentResponseData
    {
        $data = $this->get('/v1/agents/tasks/' . $taskId);

        return AgentResponseData::fromArray($data);
    }

    protected function buildPayload(string $agent, array $input, array $context, array $options): array
    {
        return [
            'agent' => $agent,
            'input' => $input,
            'context' => $context,
            'options' => $options,
            'metadata' => [
                'request_id' => (string) Str::uuid(),
                'source' => 'laravel-backend',
                'app_env' => app()->environment(),
            ],
        ];
    }

    protected function request(): PendingRequest
    {
        return Http::baseUrl(rtrim($this->baseUrl, '/'))
            ->acceptJson()
            ->asJson()
            ->withToken($this->apiKey)
            ->timeout($this->timeout)
            ->connectTimeout($this->connectTimeout)
            ->retry($this->retryTimes, $this->retrySleepMs, function ($exception, PendingRequest $request) {
                return $exception instanceof ConnectionException;
            }, throw: false);
    }

    protected function post(string $uri, array $payload): array
    {
        try {
            $response = $this->request()->post($uri, $payload);
            return $this->handleResponse($response->status(), $response->json(), 'POST', $uri);
        } catch (ConnectionException $e) {
            $this->log('error', 'OpenClaw connection timeout', [
                'uri' => $uri,
                'message' => $e->getMessage(),
            ]);

            throw new AgentTimeoutException('OpenClaw connection timeout', previous: $e);
        } catch (RequestException $e) {
            throw new AgentRemoteException('OpenClaw request failed: ' . $e->getMessage(), previous: $e);
        }
    }

    protected function get(string $uri): array
    {
        try {
            $response = $this->request()->get($uri);
            return $this->handleResponse($response->status(), $response->json(), 'GET', $uri);
        } catch (ConnectionException $e) {
            throw new AgentTimeoutException('OpenClaw retrieve timeout', previous: $e);
        } catch (RequestException $e) {
            throw new AgentRemoteException('OpenClaw retrieve failed: ' . $e->getMessage(), previous: $e);
        }
    }

    protected function handleResponse(int $status, ?array $json, string $method, string $uri): array
    {
        $json ??= [];

        $this->log('info', 'OpenClaw response received', [
            'method' => $method,
            'uri' => $uri,
            'status' => $status,
            'trace_id' => $json['trace_id'] ?? null,
            'task_id' => $json['id'] ?? null,
        ]);

        if ($status === 401 || $status === 403) {
            throw new AgentAuthenticationException($json['error']['message'] ?? 'OpenClaw authentication failed');
        }

        if ($status === 429) {
            throw new AgentRateLimitException($json['error']['message'] ?? 'OpenClaw rate limit exceeded');
        }

        if ($status >= 500) {
            throw new AgentRemoteException($json['error']['message'] ?? 'OpenClaw server error');
        }

        if ($status >= 400) {
            throw new AgentRemoteException($json['error']['message'] ?? 'OpenClaw bad request');
        }

        return $json;
    }

    protected function log(string $level, string $message, array $context = []): void
    {
        Log::channel($this->logChannel ?: config('openclaw.log_channel'))->{$level}($message, $context);
    }
}
```

这段代码有几个工程要点：

1. **统一请求入口**：所有 HTTP 行为集中在一个类里。
2. **把网络错误和业务错误分离**：ConnectionException 单独转成 Timeout 异常。
3. **日志记录 trace_id / task_id**：后面排障很重要。
4. **只对连接级错误自动 retry**：不要对 4xx/业务失败盲目重试。

## 3.7 Manager 层：给业务更稳定的调用入口

`app/AI/AgentManager.php`：

```php
<?php

namespace App\AI;

use App\AI\Contracts\AgentManagerInterface;
use App\AI\Data\AgentResponseData;

class AgentManager implements AgentManagerInterface
{
    public function __construct(
        protected OpenClawClient $client,
    ) {}

    public function run(string $agent, array $input, array $context = [], array $options = []): AgentResponseData
    {
        return $this->client->run($agent, $input, $context, $options);
    }

    public function dispatch(string $agent, array $input, array $context = [], array $options = []): AgentResponseData
    {
        return $this->client->dispatch($agent, $input, $context, $options);
    }

    public function retrieve(string $taskId): AgentResponseData
    {
        return $this->client->retrieve($taskId);
    }
}
```

你可能会觉得这层只是透传，但它的价值在于未来可以加入：

- prompt 模板注册
- agent 名称映射
- 默认上下文注入
- tenant 维度的鉴权控制
- 统一 metrics 打点

不要低估这层“看上去多余”的抽象。

## 3.8 Service Provider 注册

`app/Providers/OpenClawServiceProvider.php`：

```php
<?php

namespace App\Providers;

use App\AI\AgentManager;
use App\AI\Contracts\AgentManagerInterface;
use App\AI\OpenClawClient;
use Illuminate\Support\ServiceProvider;

class OpenClawServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(config_path('openclaw.php'), 'openclaw');

        $this->app->singleton(OpenClawClient::class, function () {
            return new OpenClawClient(
                baseUrl: config('openclaw.base_url'),
                apiKey: config('openclaw.api_key'),
                timeout: config('openclaw.timeout'),
                connectTimeout: config('openclaw.connect_timeout'),
                retryTimes: config('openclaw.retry_times'),
                retrySleepMs: config('openclaw.retry_sleep_ms'),
                logChannel: config('openclaw.log_channel'),
            );
        });

        $this->app->singleton(AgentManagerInterface::class, function ($app) {
            return new AgentManager($app->make(OpenClawClient::class));
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../../config/openclaw.php' => config_path('openclaw.php'),
        ], 'openclaw-config');
    }
}
```

如果你的 Laravel 版本开启了自动发现，可以按实际项目方式注册；如果没有，就在 `config/app.php` 中加入 provider。

---

# 四、HTTP 调用与异步队列集成

## 4.1 同步调用适合什么场景

并不是所有 AI 功能都必须走队列。同步调用适合以下情况：

- 用户主动点击后，希望立刻返回结果
- 结果生成时间可控，通常 2-8 秒
- 页面交互上允许短暂 loading
- 失败后可以直接提示用户重试

例如后台管理系统中“生成文章摘要”：

`app/Http/Controllers/Admin/ArticleSummaryController.php`

```php
<?php

namespace App\Http\Controllers\Admin;

use App\AI\Contracts\AgentManagerInterface;
use App\Http\Controllers\Controller;
use App\Models\Article;
use Illuminate\Http\JsonResponse;

class ArticleSummaryController extends Controller
{
    public function __invoke(Article $article, AgentManagerInterface $agents): JsonResponse
    {
        $response = $agents->run('content-analyzer', [
            'title' => $article->title,
            'body' => $article->content,
        ], [
            'scene' => 'article_summary',
            'article_id' => $article->id,
            'operator_id' => auth()->id(),
        ], [
            'response_format' => 'json',
            'temperature' => 0.2,
        ]);

        return response()->json([
            'task_id' => $response->id,
            'status' => $response->status,
            'data' => $response->output,
            'trace_id' => $response->traceId,
        ]);
    }
}
```

同步调用的优点是链路短、实现简单；缺点是：

- Web 请求超时风险更高
- 用户体验受第三方延迟影响
- 高并发场景容易占满 PHP-FPM / Octane worker

所以只建议把同步方式用于“轻任务”和“低频后台操作”。

## 4.2 异步队列才是主战场

真正落地到生产时，大多数任务应该走异步 Job。比如：

- 批量商品文案生成
- OCR 后的内容结构化抽取
- 工单自动分类与优先级识别
- 会话总结
- 客服知识推荐

我们先设计一张任务表，把 Laravel 侧任务状态独立保存下来。

## 4.3 任务表设计

创建 migration：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('agent_tasks', function (Blueprint $table) {
            $table->id();
            $table->string('biz_type')->index();
            $table->unsignedBigInteger('biz_id')->nullable()->index();
            $table->string('agent_name')->index();
            $table->string('task_uuid')->unique();
            $table->string('remote_task_id')->nullable()->index();
            $table->string('trace_id')->nullable()->index();
            $table->string('status')->default('pending')->index();
            $table->json('input_payload');
            $table->json('context_payload')->nullable();
            $table->json('options_payload')->nullable();
            $table->json('result_payload')->nullable();
            $table->json('usage_payload')->nullable();
            $table->string('error_code')->nullable();
            $table->text('error_message')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_tasks');
    }
};
```

这张表的作用不是简单记日志，而是承担如下职责：

- AI 任务的业务映射
- 状态流转追踪
- 重试次数记录
- 回调与轮询对账
- 审计与问题排查

## 4.4 Eloquent 模型设计

`app/Models/AgentTask.php`：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AgentTask extends Model
{
    protected $fillable = [
        'biz_type',
        'biz_id',
        'agent_name',
        'task_uuid',
        'remote_task_id',
        'trace_id',
        'status',
        'input_payload',
        'context_payload',
        'options_payload',
        'result_payload',
        'usage_payload',
        'error_code',
        'error_message',
        'attempts',
        'queued_at',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'input_payload' => 'array',
        'context_payload' => 'array',
        'options_payload' => 'array',
        'result_payload' => 'array',
        'usage_payload' => 'array',
        'queued_at' => 'datetime',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_QUEUED = 'queued';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    public function markQueued(?string $remoteTaskId = null, ?string $traceId = null): void
    {
        $this->update([
            'status' => self::STATUS_QUEUED,
            'remote_task_id' => $remoteTaskId,
            'trace_id' => $traceId,
            'queued_at' => now(),
        ]);
    }

    public function markProcessing(): void
    {
        $this->update([
            'status' => self::STATUS_PROCESSING,
            'started_at' => now(),
        ]);
    }

    public function markCompleted(array $resultPayload = [], ?array $usagePayload = null): void
    {
        $this->update([
            'status' => self::STATUS_COMPLETED,
            'result_payload' => $resultPayload,
            'usage_payload' => $usagePayload,
            'finished_at' => now(),
            'error_code' => null,
            'error_message' => null,
        ]);
    }

    public function markFailed(?string $errorCode, ?string $errorMessage): void
    {
        $this->update([
            'status' => self::STATUS_FAILED,
            'error_code' => $errorCode,
            'error_message' => $errorMessage,
            'finished_at' => now(),
        ]);
    }
}
```

## 4.5 入队 Job 设计

`app/Jobs/DispatchAgentTaskJob.php`：

```php
<?php

namespace App\Jobs;

use App\AI\Contracts\AgentManagerInterface;
use App\Models\AgentTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DispatchAgentTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(public int $agentTaskId)
    {
        $this->onQueue('ai');
    }

    public function handle(AgentManagerInterface $agents): void
    {
        $task = AgentTask::query()->findOrFail($this->agentTaskId);
        $task->increment('attempts');
        $task->markProcessing();

        $response = $agents->dispatch(
            $task->agent_name,
            $task->input_payload,
            $task->context_payload ?? [],
            $task->options_payload ?? [],
        );

        $task->markQueued($response->id, $response->traceId);

        PollAgentTaskResultJob::dispatch($task->id)
            ->delay(now()->addSeconds(config('openclaw.async_poll_interval', 10)))
            ->onQueue('ai');
    }
}
```

这段代码体现了一个实践：

- 第一阶段 Job 负责“提交远程任务”
- 第二阶段 Job 负责“轮询远程结果”

这样拆分而不是一个 Job 一直阻塞等待，是因为 Laravel Worker 不应该长时间被一个 AI 请求吊住。

## 4.6 轮询 Job 设计

`app/Jobs/PollAgentTaskResultJob.php`：

```php
<?php

namespace App\Jobs;

use App\AI\Contracts\AgentManagerInterface;
use App\Models\AgentTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class PollAgentTaskResultJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 10;

    public function __construct(public int $agentTaskId)
    {
        $this->onQueue('ai');
    }

    public function backoff(): array
    {
        return [10, 20, 30, 60, 120];
    }

    public function handle(AgentManagerInterface $agents): void
    {
        $task = AgentTask::query()->findOrFail($this->agentTaskId);

        if (!$task->remote_task_id) {
            return;
        }

        $response = $agents->retrieve($task->remote_task_id);

        if ($response->isPending()) {
            static::dispatch($task->id)
                ->delay(now()->addSeconds(config('openclaw.async_poll_interval', 10)))
                ->onQueue('ai');
            return;
        }

        if ($response->isCompleted()) {
            $task->markCompleted($response->output ?? [], $response->usage);
            ProcessAgentResultJob::dispatch($task->id)->onQueue('ai');
            return;
        }

        $task->markFailed($response->errorCode, $response->errorMessage ?? 'Agent task failed');
    }
}
```

## 4.7 为什么不用 while 循环轮询

有些人会在 Job 里写：

```php
while (true) {
    $result = $agents->retrieve($taskId);
    if ($result->isCompleted()) {
        break;
    }
    sleep(5);
}
```

这在开发环境里似乎能工作，但在线上是个典型反模式，因为：

- 持续占用 worker
- 无法被队列系统细粒度重试
- 容易导致任务超时
- sleep 期间没有任何可观测性
- Horizon 监控粒度差

正确思路是把“等待”交给队列调度器，而不是让 PHP 进程傻等。

---

# 五、Agent 结果处理与 Eloquent 存储

## 5.1 结果处理为什么不能直接把 raw JSON 塞数据库

很多团队的第一反应是：

- 把第三方完整响应 JSON 存下来
- 需要用的时候再从 JSON 里解析

这当然应该做一份归档，但不能只这么做。因为业务层真正需要的是结构化字段。例如文章摘要场景，业务需要的可能是：

- summary
- seo_title
- seo_description
- keywords
- sentiment
- risk_flags

如果不做结构化存储，后面做查询、筛选、排序、统计都很痛苦。

建议采用“双轨存储”：

1. **原始结果归档**：保证可审计、可回放
2. **业务结构化字段抽取**：保证后续业务可用

## 5.2 示例：文章 AI 分析结果表

建表：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('article_ai_results', function (Blueprint $table) {
            $table->id();
            $table->foreignId('article_id')->constrained()->cascadeOnDelete();
            $table->foreignId('agent_task_id')->constrained()->cascadeOnDelete();
            $table->text('summary')->nullable();
            $table->string('seo_title')->nullable();
            $table->text('seo_description')->nullable();
            $table->json('keywords')->nullable();
            $table->string('sentiment')->nullable();
            $table->json('risk_flags')->nullable();
            $table->json('raw_output')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('article_ai_results');
    }
};
```

模型：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ArticleAiResult extends Model
{
    protected $fillable = [
        'article_id',
        'agent_task_id',
        'summary',
        'seo_title',
        'seo_description',
        'keywords',
        'sentiment',
        'risk_flags',
        'raw_output',
    ];

    protected $casts = [
        'keywords' => 'array',
        'risk_flags' => 'array',
        'raw_output' => 'array',
    ];
}
```

## 5.3 定义输出映射器

不要把字段解析逻辑写到 Controller 或 Job 里，建议做专门 Mapper：

`app/AI/Mappers/ArticleAnalysisResultMapper.php`

```php
<?php

namespace App\AI\Mappers;

class ArticleAnalysisResultMapper
{
    public function map(array $output): array
    {
        return [
            'summary' => $output['summary'] ?? null,
            'seo_title' => $output['seo_title'] ?? null,
            'seo_description' => $output['seo_description'] ?? null,
            'keywords' => $this->normalizeKeywords($output['keywords'] ?? []),
            'sentiment' => $output['sentiment'] ?? null,
            'risk_flags' => $output['risk_flags'] ?? [],
            'raw_output' => $output,
        ];
    }

    protected function normalizeKeywords(mixed $keywords): array
    {
        if (is_string($keywords)) {
            return array_values(array_filter(array_map('trim', explode(',', $keywords))));
        }

        if (is_array($keywords)) {
            return array_values(array_filter(array_map(function ($item) {
                return is_scalar($item) ? trim((string) $item) : null;
            }, $keywords)));
        }

        return [];
    }
}
```

这里的经验非常重要：**AI 输出即使声明了 JSON，也不代表永远稳定**。生产中经常出现：

- keywords 本来是数组，偶尔变成逗号分隔字符串
- 某些字段为空字符串而不是 null
- risk_flags 明明应该是数组，却返回对象

所以 Mapper 层必须做归一化，而不能盲信远程结果。

## 5.4 结果消费 Job

`app/Jobs/ProcessAgentResultJob.php`：

```php
<?php

namespace App\Jobs;

use App\AI\Mappers\ArticleAnalysisResultMapper;
use App\Models\AgentTask;
use App\Models\ArticleAiResult;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

class ProcessAgentResultJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public int $agentTaskId)
    {
        $this->onQueue('ai');
    }

    public function handle(ArticleAnalysisResultMapper $mapper): void
    {
        $task = AgentTask::query()->findOrFail($this->agentTaskId);

        if ($task->biz_type !== 'article' || !$task->biz_id) {
            return;
        }

        $mapped = $mapper->map($task->result_payload ?? []);

        DB::transaction(function () use ($task, $mapped) {
            ArticleAiResult::query()->updateOrCreate(
                [
                    'article_id' => $task->biz_id,
                    'agent_task_id' => $task->id,
                ],
                $mapped,
            );
        });
    }
}
```

为什么这里要 `updateOrCreate`？因为实际生产中经常出现：

- webhook 与 polling 同时到达
- 运维手动补偿重放了处理任务
- 任务重试导致同一个结果被处理多次

因此结果消费必须尽量幂等。

## 5.5 API 设计：业务侧如何查看任务结果

如果要给前端提供查询任务状态的接口，可以设计成：

### 提交任务

`POST /api/articles/{article}/ai-summary`

返回：

```json
{
  "task_uuid": "2cb90766-f62d-4c55-bd57-2dd8cf317746",
  "status": "pending"
}
```

### 查询任务状态

`GET /api/agent-tasks/{task_uuid}`

返回：

```json
{
  "task_uuid": "2cb90766-f62d-4c55-bd57-2dd8cf317746",
  "status": "completed",
  "trace_id": "trace_abc123",
  "result": {
    "summary": "...",
    "keywords": ["Laravel", "OpenClaw"]
  },
  "error": null
}
```

控制器示例：

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\DispatchAgentTaskJob;
use App\Models\AgentTask;
use App\Models\Article;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class ArticleAiSummaryController extends Controller
{
    public function store(Article $article): JsonResponse
    {
        $task = AgentTask::query()->create([
            'biz_type' => 'article',
            'biz_id' => $article->id,
            'agent_name' => 'content-analyzer',
            'task_uuid' => (string) Str::uuid(),
            'status' => AgentTask::STATUS_PENDING,
            'input_payload' => [
                'title' => $article->title,
                'body' => $article->content,
            ],
            'context_payload' => [
                'scene' => 'article_summary',
                'article_id' => $article->id,
                'requested_by' => auth()->id(),
            ],
            'options_payload' => [
                'response_format' => 'json',
                'temperature' => 0.2,
            ],
        ]);

        DispatchAgentTaskJob::dispatch($task->id)->onQueue('ai');

        return response()->json([
            'task_uuid' => $task->task_uuid,
            'status' => $task->status,
        ], 202);
    }

    public function show(string $taskUuid): JsonResponse
    {
        $task = AgentTask::query()->where('task_uuid', $taskUuid)->firstOrFail();

        return response()->json([
            'task_uuid' => $task->task_uuid,
            'status' => $task->status,
            'trace_id' => $task->trace_id,
            'result' => $task->result_payload,
            'error' => $task->error_code ? [
                'code' => $task->error_code,
                'message' => $task->error_message,
            ] : null,
        ]);
    }
}
```

这就是比较标准的“前台发起、后台异步执行、前台轮询状态”的 Laravel API 设计。

---

# 六、错误处理与重试机制

## 6.1 AI 集成最怕的不是报错，而是错误被错误地处理

在传统 CRUD 系统里，很多异常处理都比较直线：

- 失败就报错
- 用户重试一下
- 后台日志看看

但 AI 场景不是这样，因为错误来源多且语义不同：

- 网络超时
- DNS / TLS 问题
- 认证失败
- 限流
- 上游 5xx
- 请求参数非法
- Agent 内部执行失败
- 输出结构异常
- 本地数据库写入失败

如果不做分类，就很容易出现两类严重问题：

1. **不该重试的错误被重试**，浪费成本甚至触发封禁
2. **应该重试的错误没有重试**，导致大量临时失败变成永久失败

## 6.2 队列 Job 中的差异化重试

以提交 Job 为例：

```php
public function backoff(): array
{
    return [5, 15, 30];
}
```

但更进一步，应该在 `handle()` 中结合异常类型处理：

```php
<?php

namespace App\Jobs;

use App\AI\Contracts\AgentManagerInterface;
use App\AI\Exceptions\AgentAuthenticationException;
use App\AI\Exceptions\AgentRateLimitException;
use App\AI\Exceptions\AgentRemoteException;
use App\AI\Exceptions\AgentTimeoutException;
use App\Models\AgentTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DispatchAgentTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public function __construct(public int $agentTaskId)
    {
        $this->onQueue('ai');
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120];
    }

    public function handle(AgentManagerInterface $agents): void
    {
        $task = AgentTask::query()->findOrFail($this->agentTaskId);

        try {
            $task->increment('attempts');
            $task->markProcessing();

            $response = $agents->dispatch(
                $task->agent_name,
                $task->input_payload,
                $task->context_payload ?? [],
                $task->options_payload ?? [],
            );

            $task->markQueued($response->id, $response->traceId);

            PollAgentTaskResultJob::dispatch($task->id)
                ->delay(now()->addSeconds(config('openclaw.async_poll_interval', 10)))
                ->onQueue('ai');
        } catch (AgentAuthenticationException $e) {
            $task->markFailed('auth_error', $e->getMessage());
            $this->fail($e);
        } catch (AgentRateLimitException $e) {
            throw $e;
        } catch (AgentTimeoutException|AgentRemoteException $e) {
            throw $e;
        } catch (\Throwable $e) {
            $task->markFailed('unexpected_error', $e->getMessage());
            throw $e;
        }
    }

    public function failed(\Throwable $e): void
    {
        $task = AgentTask::query()->find($this->agentTaskId);
        if (!$task) {
            return;
        }

        if ($task->status !== AgentTask::STATUS_COMPLETED) {
            $task->markFailed('dispatch_failed', $e->getMessage());
        }
    }
}
```

这里的策略是：

- `AgentAuthenticationException`：配置错误，重试没有意义，直接 fail
- `AgentRateLimitException`：可能是临时问题，交给队列 backoff
- `AgentTimeoutException / AgentRemoteException`：通常可以有限重试
- 其他未知异常：记录并上抛，防止无声失败

## 6.3 幂等性设计

AI 任务很容易被重复执行，原因包括：

- Job 重试
- webhook 重发
- 用户重复点击
- 前端超时后又重新提交
- worker 在处理完但 ack 前崩溃

因此必须设计幂等。

### 幂等键建议

可以基于以下信息生成 fingerprint：

- biz_type
- biz_id
- agent_name
- input_payload hash
- prompt/version

例如：

```php
$fingerprint = hash('sha256', json_encode([
    'biz_type' => 'article',
    'biz_id' => $article->id,
    'agent_name' => 'content-analyzer',
    'input' => [
        'title' => $article->title,
        'body' => $article->content,
    ],
    'version' => 'v1',
], JSON_UNESCAPED_UNICODE));
```

然后在数据库中加唯一索引，避免相同任务被重复创建。

## 6.4 使用 Laravel Cache Lock 防止重复调度

在任务创建入口可以加分布式锁：

```php
use Illuminate\Support\Facades\Cache;

$lockKey = 'agent-task:article:' . $article->id . ':summary';

$task = Cache::lock($lockKey, 10)->block(3, function () use ($article) {
    return AgentTask::query()->firstOrCreate(
        [
            'biz_type' => 'article',
            'biz_id' => $article->id,
            'agent_name' => 'content-analyzer',
            'status' => AgentTask::STATUS_PENDING,
        ],
        [
            'task_uuid' => (string) \Illuminate\Support\Str::uuid(),
            'input_payload' => [
                'title' => $article->title,
                'body' => $article->content,
            ],
        ],
    );
});
```

这可以降低并发点击带来的重复任务问题。

## 6.5 回调模式下的签名校验

如果 OpenClaw 支持 webhook 回调，千万不要直接信任请求体。至少应校验：

- 时间戳
- 签名
- 重放窗口
- task_id 是否存在

示例：

```php
<?php

namespace App\Http\Controllers\Webhook;

use App\Http\Controllers\Controller;
use App\Models\AgentTask;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class OpenClawWebhookController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $signature = $request->header('X-OpenClaw-Signature');
        $timestamp = $request->header('X-OpenClaw-Timestamp');
        $payload = $request->getContent();

        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, config('openclaw.webhook_secret'));

        abort_unless(hash_equals($expected, (string) $signature), 401, 'Invalid signature');
        abort_unless(abs(now()->timestamp - (int) $timestamp) <= 300, 401, 'Expired webhook');

        $data = $request->json()->all();

        $task = AgentTask::query()
            ->where('remote_task_id', $data['id'] ?? '')
            ->first();

        if (!$task) {
            return response('ok', 200);
        }

        if (($data['status'] ?? null) === 'completed') {
            $task->markCompleted($data['output'] ?? [], $data['usage'] ?? null);
        } elseif (($data['status'] ?? null) === 'failed') {
            $task->markFailed(
                $data['error']['code'] ?? 'remote_failed',
                $data['error']['message'] ?? 'Remote task failed'
            );
        }

        return response('ok', 200);
    }
}
```

生产里 webhook 和 polling 可以并存，但要确保处理逻辑幂等。

---

# 七、性能优化与生产部署注意事项

## 7.1 不要把 AI 调用当普通 API 调用

很多系统上线后性能出问题，本质原因是团队误把 AI 调用当成普通内部服务调用。实际上 AI 调用通常具备以下特征：

- 平均延迟更高
- 响应体更大
- 成本和 token 使用强相关
- 失败形式更多样
- 输出波动更大
- 上游限流更严格

所以生产设计必须单独考虑。

## 7.2 队列隔离

一定要把 AI 任务放到单独队列，例如：

```bash
php artisan queue:work --queue=default,emails
php artisan queue:work --queue=ai --tries=3 --timeout=180
```

原因是：

- AI 任务耗时长，不能阻塞普通业务队列
- AI 队列可以配置不同超时时间
- Horizon 里可以单独观察吞吐和失败率
- 后续限流、扩容、降级更方便

如果你使用 Horizon，建议单独 supervisor：

```php
'environments' => [
    'production' => [
        'supervisor-default' => [
            'connection' => 'redis',
            'queue' => ['default'],
            'balance' => 'auto',
            'processes' => 10,
            'tries' => 3,
        ],
        'supervisor-ai' => [
            'connection' => 'redis',
            'queue' => ['ai'],
            'balance' => 'auto',
            'processes' => 5,
            'tries' => 5,
            'timeout' => 180,
        ],
    ],
],
```

## 7.3 限流与并发控制

你本地压测没问题，不代表线上不会被 429 打爆。建议在 Laravel 侧主动限流。

### 方式一：提交前限流

```php
use Illuminate\Support\Facades\RateLimiter;

$key = 'openclaw:tenant:' . $tenantId;

if (RateLimiter::tooManyAttempts($key, 60)) {
    abort(429, 'AI request rate limit exceeded');
}

RateLimiter::hit($key, 60);
```

### 方式二：队列消费限流

Laravel 里可以通过 middleware 控制 Job 速率，比如基于 Redis 限制每秒提交数。

如果你是多租户系统，这一步尤其重要，否则一个大客户的批量任务就可能拖垮整个 Agent 通道。

## 7.4 缓存结果，避免重复消耗

有一类场景非常适合缓存：

- 输入内容基本不变
- 输出允许短时间复用
- 结果计算成本较高

比如文章摘要、SEO 标签提取等，可以根据内容 hash 建缓存：

```php
$contentHash = hash('sha256', $article->title . "\n" . $article->content);
$cacheKey = 'ai:article-summary:' . $contentHash;

$result = cache()->remember($cacheKey, now()->addDays(7), function () use ($agents, $article) {
    $response = $agents->run('content-analyzer', [
        'title' => $article->title,
        'body' => $article->content,
    ]);

    return $response->output;
});
```

这不是为了“省几毫秒”，而是为了节省真实调用成本。

## 7.5 Prompt / Agent 版本化

这是很多团队第一年就踩的坑：

- 上线时 prompt 写在代码里
- 后面不断修改 prompt
- 结果风格和结构突然变化
- 老数据和新数据混在一起，无法解释差异

正确做法是对 Agent 配置做版本化。例如：

```php
return [
    'article_summary' => [
        'agent' => 'content-analyzer',
        'version' => '2026-06-01',
        'system_prompt' => '你是一个资深内容编辑，请输出 JSON 格式结果...',
        'schema' => [
            'summary' => 'string',
            'seo_title' => 'string',
            'seo_description' => 'string',
            'keywords' => 'array',
        ],
    ],
];
```

然后把 `version` 一起存入 `agent_tasks`，这样后面排查“为什么 6 月 1 日前后的结果不一样”时，就有据可依。

## 7.6 监控与日志

至少要打这些字段：

- local task id
- remote task id
- trace id
- agent name
- biz type / biz id
- latency
- token usage
- error code
- attempt count

可以在日志里统一输出 JSON context：

```php
Log::channel('openclaw')->info('Agent task completed', [
    'task_id' => $task->id,
    'remote_task_id' => $task->remote_task_id,
    'trace_id' => $task->trace_id,
    'agent' => $task->agent_name,
    'biz_type' => $task->biz_type,
    'biz_id' => $task->biz_id,
    'usage' => $task->usage_payload,
]);
```

如果你有 Prometheus / Grafana，可以进一步做这些指标：

- `agent_request_total`
- `agent_request_failed_total`
- `agent_request_latency_ms`
- `agent_tokens_input_total`
- `agent_tokens_output_total`
- `agent_queue_wait_seconds`

这样才能回答真实业务问题，而不只是“有没有报错”。

## 7.7 数据脱敏与合规

Laravel 项目里接入 AI 时，最容易被忽略的是数据安全。尤其是 CRM、医疗、法务、财务等系统，输入里很可能包含：

- 用户手机号
- 身份证号
- 邮箱
- 地址
- 合同金额
- 内部业务备注

在发送给 OpenClaw 前，应考虑：

- 是否必须传全部字段
- 是否需要脱敏
- 是否要做 tenant 级访问隔离
- 结果是否能长期存储
- 日志中是否记录了原文内容

建议对日志做白名单记录，而不是把完整 prompt / input 原样打到日志里。你真正需要的是 trace 能力，不是泄漏敏感信息。

## 7.8 生产部署中的几个常见坑

### 坑一：队列 timeout 小于远程超时

比如：

- OpenClaw timeout = 60 秒
- queue worker timeout = 30 秒

那么 worker 会先把 Job 杀掉，造成任务状态混乱。一般建议：

- HTTP timeout < queue worker timeout < supervisor 强制回收阈值

例如：

- HTTP timeout 30s
- worker timeout 90s
- Horizon/supervisor 外层再留更大空间

### 坑二：重试后重复写库

如果结果处理没有幂等，重试会导致：

- 重复插入记录
- 计费数据翻倍
- 下游事件重复触发

所以所有消费结果的逻辑都要按“至少一次投递”来设计。

### 坑三：把第三方错误信息直接返回前端

第三方错误可能包含内部实现信息，甚至暴露供应商细节。建议统一转换成业务可理解文案，对外输出通用错误码。

### 坑四：没有任务审计页

当运营、产品、客服来问“为什么这条生成失败了”，如果你只能翻日志，那这套系统很快就会变成团队负担。建议做一个简单后台页，至少能查看：

- 任务状态
- 提交时间
- 重试次数
- trace id
- 错误码
- 原始响应摘要

### 坑五：没有降级策略

AI 服务不稳定时，系统应该知道如何优雅降级。例如：

- 文章摘要功能暂时隐藏“自动生成”按钮
- 客服建议从“实时生成”切到“模板兜底”
- 批量任务暂停提交，只允许人工审批后重试

这比让整个页面一直转圈更专业。

---

# 八、一个相对完整的落地架构总结

如果把整套集成方案串起来，一个比较稳健的 Laravel + OpenClaw 架构可以是这样：

1. 前端或后台操作发起 AI 任务请求
2. Laravel Controller 创建本地 `agent_tasks` 记录
3. `DispatchAgentTaskJob` 异步提交任务到 OpenClaw
4. 保存 `remote_task_id` 与 `trace_id`
5. 通过 `PollAgentTaskResultJob` 或 webhook 获取结果
6. 将原始结果保存到 `agent_tasks.result_payload`
7. `ProcessAgentResultJob` 做结构化映射并写入业务表
8. API 提供任务状态查询与最终结果读取
9. 日志、监控、限流、重试、幂等等围绕任务表展开

其核心思想只有一句话：

> **不要把 OpenClaw 当成一个“随手调用的第三方接口”，而要把它当成 Laravel 系统中的一类“可治理的远程执行基础设施”。**

一旦你按这个思路建设，后面接入的就不只是一个 Agent，而是一整套 AI 能力底座。

---

# 九、实战经验：一些值得提前避开的坑

最后再补充一些更偏实战的经验，很多都来自线上问题而不是 Demo。

## 9.1 先定义输出 schema，再写 prompt

很多人习惯先写一个“看起来很聪明”的 prompt，再让模型自由发挥。对内容生成类也许还行，但对业务系统非常危险。正确顺序应是：

1. 先定义业务表结构
2. 再定义 API 返回 schema
3. 再定义 Mapper 归一化规则
4. 最后写 prompt 约束输出

因为系统真正消费的是结构，而不是文采。

## 9.2 不要让 Agent 直接决定最终业务状态

比如工单分类、风控标记、内容审核等高风险场景，不建议让 Agent 结果直接改核心状态。更好的做法是：

- Agent 给出建议和置信度
- 系统根据规则做二次决策
- 高风险结果进入人工审核

AI 更适合作为“增强器”，而不是不受约束的最终裁判。

## 9.3 尽量保留输入快照

后面排查问题时，最常见的尴尬是：

- 数据表里的文章内容已经被编辑过
- 但 AI 结果是几天前生成的
- 你已经不知道当时到底提交了什么输入

因此建议在 `agent_tasks.input_payload` 中保留当时的输入快照，而不是只存业务主键。

## 9.4 对大文本做切片时要记录切片策略

如果你处理的是长合同、长报告、长聊天记录，通常会做 chunking。请把这些元信息也记录下来：

- chunk size
- overlap
- 排序方式
- 处理版本
- 是否截断

否则结果质量发生变化时，你很难判断是 prompt 变了、模型变了，还是切片策略变了。

## 9.5 尽量给每个场景单独 agent 名称

不要什么都用 `general-assistant`。推荐按场景命名：

- `article-summary-agent`
- `ticket-classifier-agent`
- `product-copywriter-agent`
- `contract-risk-review-agent`

这样日志、限流、监控、成本分析都会更清晰。

---

# 十、结语

Laravel 并不天然排斥 AI，相反，它非常适合承载企业级 AI Agent 集成。因为 Laravel 擅长的从来不只是“快速写页面”，更是把复杂业务能力沉淀为统一服务：配置、容器、队列、数据库、日志、缓存、调度，这些恰恰都是 AI 真正落地时最需要的工程基础。

OpenClaw 与 Laravel 的结合，关键不在于会不会发一个 HTTP 请求，而在于你是否把它封装成：

- 可复用的服务入口
- 可观察的任务体系
- 可恢复的异步流程
- 可审计的结果存储
- 可演进的 API 和 schema

如果只是做 Demo，几行代码就够了；但如果你要把 AI Agent 能力放进真实 PHP 项目，真正决定成败的，往往是今天文章里这些“看上去不酷”的工程细节。

总结一下本文的落地建议：

1. 用 Laravel Service Provider + Manager 模式封装 OpenClaw
2. 把同步调用控制在小而快的场景，主流程尽量走队列
3. 建立本地 `agent_tasks` 表，统一承载状态、审计和追踪
4. 用 DTO、Mapper、异常体系隔离第三方变化
5. 对结果消费、回调处理、重复提交全面做幂等设计
6. 生产环境必须配置限流、监控、缓存、日志与降级策略
7. 永远把结构化输出和治理能力放在“模型效果”之前考虑

当你完成这些工作后，OpenClaw 在 Laravel 中就不再只是一个“AI 按钮”，而是你系统里的正式能力节点。后续无论是继续扩展知识问答、自动流程编排、内容理解、客服增强，还是把更多 Agent 场景沉淀到平台层，都会轻松很多。

如果你接下来准备在现有 Laravel 项目中正式接入 AI，我建议从一个低风险、高价值、易衡量 ROI 的场景开始，例如文章摘要、工单分类、商品卖点提取。先把基础设施搭好，再逐步把 Agent 能力平台化，而不是一开始就试图做一个“全自动自治系统”。

这才是 PHP 团队把 AI 真正用起来的更现实路径。

## 相关阅读

- [OpenClaw 技能开发实战：自定义 Skill 与工作流自动化](/categories/架构/OpenClaw-技能开发实战-自定义-Skill-与工作流自动化/)
- [OpenClaw 模型策略实战：多模型路由与成本优化](/categories/架构/OpenClaw-模型策略实战-多模型路由与成本优化/)
- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比/)
