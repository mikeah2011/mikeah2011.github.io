---
title: Arize Phoenix 实战：开源 LLM 可观测性——Trace/Prompt/Embedding 的全链路调试与 Laravel Agent 集成
keywords: [Arize Phoenix, LLM, Trace, Prompt, Embedding, Laravel Agent, 开源, 可观测性, 的全链路调试与, AI]
date: 2026-06-10 00:10:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - LLM
  - 可观测性
  - Arize Phoenix
  - Tracing
  - Laravel
  - Agent
description: 深入 Arize Phoenix 开源平台，从 Trace/Prompt/Embedding 三个维度实现 LLM 全链路可观测性，包含 Laravel Agent 项目集成实战与踩坑记录。
---


## 为什么 LLM 需要可观测性？

传统的 Web 应用调试，我们有 Sentry、DataDog、New Relic。请求进来，SQL 慢了，报错了，日志清清楚楚。但 LLM 应用不一样——同一个 Prompt，同一个模型，输出可能完全不同。调试变成了「薛定谔的 debug」。

更麻烦的是：

- **Token 成本不透明**：一次调用花了多少钱？哪些 Prompt 在烧钱？
- **幻觉难以定位**：模型胡说八道时，是 Prompt 的问题还是模型的问题？
- **延迟不可解释**：为什么这个请求慢了 3 倍？是向量检索慢还是 LLM 生成慢？
- **质量无法量化**：用户说「回答不对」，但你连「原来应该回答什么」都不知道

Arize Phoenix 是目前最成熟的开源 LLM 可观测性平台，解决的就是这些问题。

<!-- more -->

## 核心概念：Phoenix 的三大支柱

Phoenix 的可观测性建立在三个核心维度上：

### 1. Trace（链路追踪）

每一次 LLM 交互——从用户输入到最终输出——被记录为一条 Trace。Trace 内部可以包含多个 Span：

```
用户请求
├── Span: 向量检索 (Pinecone/Weaviate)
├── Span: Prompt 构建
├── Span: LLM 调用 (GPT-4/Claude)
└── Span: 结果后处理
```

每个 Span 记录了输入、输出、耗时、Token 用量、模型参数。这让慢查询定位变得和传统 APM 一样直观。

### 2. Prompt 管理与评估

Phoenix 允许你：

- **版本化管理 Prompt**：同一个功能的 Prompt 迭代历史，一目了然
- **A/B 测试**：不同 Prompt 版本的输出质量对比
- **自动评估**：用 LLM-as-Judge 或自定义评估器量化 Prompt 质量

### 3. Embedding 可观测性

RAG 系统的痛点：检索回来的文档片段到底对不对？Phoenix 通过降维可视化（UMAP/t-SNE）展示 Embedding 空间：

- 查询向量和文档向量的距离
- 检索结果的相关性分布
- 聚类分析：哪些文档总是被一起检索

## 实战：Phoenix 本地部署

### Docker 一键启动

Phoenix 提供了开箱即用的 Docker 镜像：

```bash
docker run -d \
  --name phoenix \
  -p 6006:6006 \
  -p 9090:9090 \
  -e PHOENIX_SQL_DATABASE_URL=postgresql://user:pass@host:5432/phoenix \
  arize/phoenix:latest
```

如果不想配 PostgreSQL，用 SQLite 也行（开发环境够用）：

```bash
docker run -d \
  --name phoenix \
  -p 6006:6006 \
  arize/phoenix:latest
```

启动后访问 `http://localhost:6006`，Phoenix 的 UI 就出来了。

### Python SDK 集成

Phoenix 的 Python SDK `arize-phoenix` 是核心接入方式：

```bash
pip install arize-phoenix openinference-instrumentation-openai
```

最小化接入示例：

```python
import phoenix as px
from phoenix.otel import register
from openinference.instrumentation.openai import OpenAIInstrumentor

# 启动 Phoenix（如果还没启动）
px.launch_app()

# 注册 tracer
tracer_provider = register(endpoint="http://localhost:6006/v1/traces")

# 自动 instrument OpenAI
OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)

# 之后你的 OpenAI 调用会被自动追踪
from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "什么是可观测性？"}]
)
```

运行后，Phoenix UI 里就能看到这条 Trace 了。

## Laravel Agent 项目集成

在 PHP/Laravel 项目中集成 Phoenix，核心思路是通过 HTTP API 发送 Trace 数据。Phoenix 兼容 OpenTelemetry 协议，我们直接用 HTTP 推送 Span。

### 封装 Phoenix Trace 客户端

```php
<?php

namespace App\Support\Observability;

use Illuminate\Http\Client\PendingBatch;
use Illuminate\Support\Facades\Http;

class PhoenixTracer
{
    private string $endpoint;
    private string $sessionId;

    public function __construct(
        string $endpoint = 'http://localhost:6006',
        ?string $sessionId = null
    ) {
        $this->endpoint = rtrim($endpoint, '/');
        $this->sessionId = $sessionId ?? uniqid('session_', true);
    }

    /**
     * 记录一次 LLM 调用的 Trace
     */
    public function traceLLMCall(array $params): array
    {
        $traceId = $this->generateTraceId();
        $spanId = $this->generateSpanId();
        $startTime = microtime(true);

        // 构建 Span 数据（OpenTelemetry 兼容格式）
        $span = [
            'name' => $params['name'] ?? 'llm_call',
            'traceId' => $traceId,
            'spanId' => $spanId,
            'parentSpanId' => $params['parent_span_id'] ?? null,
            'startTimeUnixNano' => (string) ($startTime * 1e9),
            'endTimeUnixNano' => null, // 调用结束后填充
            'attributes' => [
                'llm.model' => $params['model'] ?? 'unknown',
                'llm.input.messages' => json_encode($params['messages'] ?? []),
                'llm.output.message' => $params['output'] ?? '',
                'llm.token_count.input' => $params['input_tokens'] ?? 0,
                'llm.token_count.output' => $params['output_tokens'] ?? 0,
                'llm.invocation_parameters' => json_encode($params['params'] ?? []),
                'session.id' => $this->sessionId,
            ],
        ];

        return [
            'trace_id' => $traceId,
            'span' => $span,
            'start_time' => $startTime,
        ];
    }

    /**
     * 发送 Span 到 Phoenix
     */
    public function sendSpan(array $spanData, float $startTime): void
    {
        $endTime = microtime(true);
        $spanData['endTimeUnixNano'] = (string) ($endTime * 1e9);
        $spanData['duration_ms'] = round(($endTime - $startTime) * 1000, 2);

        // Phoenix 的 traces 端点
        Http::withHeaders([
            'Content-Type' => 'application/json',
        ])->post("{$this->endpoint}/v1/traces", [
            'spans' => [$spanData],
        ]);
    }

    /**
     * 记录 Embedding 检索的 Trace
     */
    public function traceRetrieval(array $params): array
    {
        $traceId = $this->generateTraceId();
        $spanId = $this->generateSpanId();
        $startTime = microtime(true);

        $span = [
            'name' => 'retrieval',
            'traceId' => $traceId,
            'spanId' => $spanId,
            'parentSpanId' => $params['parent_span_id'] ?? null,
            'startTimeUnixNano' => (string) ($startTime * 1e9),
            'endTimeUnixNano' => null,
            'attributes' => [
                'retrieval.query' => $params['query'] ?? '',
                'retrieval.results_count' => count($params['results'] ?? []),
                'retrieval.results' => json_encode($params['results'] ?? []),
                'retrieval.vector_store' => $params['vector_store'] ?? 'unknown',
                'retrieval.top_k' => $params['top_k'] ?? 5,
                'retrieval.score_threshold' => $params['score_threshold'] ?? 0.0,
                'session.id' => $this->sessionId,
            ],
        ];

        return [
            'trace_id' => $traceId,
            'span' => $span,
            'start_time' => $startTime,
        ];
    }

    /**
     * 记录 Agent 循环的 Trace
     */
    public function traceAgentLoop(array $params): array
    {
        $traceId = $this->generateTraceId();
        $spanId = $this->generateSpanId();
        $startTime = microtime(true);

        $span = [
            'name' => 'agent_loop',
            'traceId' => $traceId,
            'spanId' => $spanId,
            'parentSpanId' => $params['parent_span_id'] ?? null,
            'startTimeUnixNano' => (string) ($startTime * 1e9),
            'endTimeUnixNano' => null,
            'attributes' => [
                'agent.tool_calls' => json_encode($params['tool_calls'] ?? []),
                'agent.iterations' => $params['iterations'] ?? 0,
                'agent.final_output' => $params['final_output'] ?? '',
                'agent.total_tokens' => $params['total_tokens'] ?? 0,
                'agent.total_cost_usd' => $params['total_cost'] ?? 0.0,
                'session.id' => $this->sessionId,
            ],
        ];

        return [
            'trace_id' => $traceId,
            'span' => $span,
            'start_time' => $startTime,
        ];
    }

    private function generateTraceId(): string
    {
        return bin2hex(random_bytes(16));
    }

    private function generateSpanId(): string
    {
        return bin2hex(random_bytes(8));
    }
}
```

### 在 Laravel Agent Service 中集成

```php
<?php

namespace App\Services;

use App\Support\Observability\PhoenixTracer;
use Illuminate\Support\Facades\Http;

class AgentService
{
    private PhoenixTracer $tracer;

    public function __construct(PhoenixTracer $tracer)
    {
        $this->tracer = $tracer;
    }

    /**
     * 带可观测性的 Agent 执行
     */
    public function run(string $userMessage): string
    {
        // 1. 检索阶段的 Trace
        $retrieval = $this->tracer->traceRetrieval([
            'query' => $userMessage,
            'top_k' => 5,
            'score_threshold' => 0.7,
            'vector_store' => 'pinecone',
        ]);

        $context = $this->retrieveContext($userMessage);
        $this->tracer->sendSpan($retrieval['span'], $retrieval['start_time']);

        // 2. LLM 调用的 Trace
        $llmTrace = $this->tracer->traceLLMCall([
            'name' => 'agent_response',
            'model' => 'gpt-4',
            'messages' => [
                ['role' => 'system', 'content' => '你是一个有帮助的助手。'],
                ['role' => 'user', 'content' => $userMessage],
            ],
            'params' => ['temperature' => 0.7, 'max_tokens' => 2000],
        ]);

        $response = $this->callLLM($userMessage, $context);
        $this->tracer->sendSpan($llmTrace['span'], $llmTrace['start_time']);

        return $response;
    }

    private function retrieveContext(string $query): string
    {
        // 向量检索逻辑
        $results = Http::post('https://api.pinecone.io/query', [
            'vector' => $this->getEmbedding($query),
            'topK' => 5,
            'includeMetadata' => true,
        ])->json();

        return collect($results['matches'] ?? [])
            ->pluck('metadata.text')
            ->implode("\n\n");
    }

    private function callLLM(string $query, string $context): string
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
        ])->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4',
            'messages' => [
                ['role' => 'system', 'content' => "基于以下上下文回答问题：\n{$context}"],
                ['role' => 'user', 'content' => $query],
            ],
            'temperature' => 0.7,
        ])->json();

        return $response['choices'][0]['message']['content'] ?? '';
    }

    private function getEmbedding(string $text): array
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
        ])->post('https://api.openai.com/v1/embeddings', [
            'model' => 'text-embedding-3-small',
            'input' => $text,
        ])->json();

        return $response['data'][0]['embedding'] ?? [];
    }
}
```

### 自定义评估器

Phoenix 支持自定义评估器，用来自动评判 LLM 输出质量：

```php
<?php

namespace App\Support\Observability;

use Illuminate\Support\Facades\Http;

class PhoenixEvaluator
{
    private string $phoenixEndpoint;

    public function __construct(string $phoenixEndpoint = 'http://localhost:6006')
    {
        $this->phoenixEndpoint = rtrim($phoenixEndpoint, '/');
    }

    /**
     * 相关性评估：检索结果与查询是否相关
     */
    public function evaluateRelevance(string $query, array $retrievedDocs): array
    {
        $scores = [];
        foreach ($retrievedDocs as $index => $doc) {
            // 用 LLM 作为评判者
            $prompt = "查询：{$query}\n\n文档片段：{$doc}\n\n"
                     . "请评估文档与查询的相关性，评分 0-1（0=完全无关，1=完全相关）。\n"
                     . "只返回数字。";

            $score = (float) $this->callJudge($prompt);
            $scores[$index] = $score;
        }

        return $scores;
    }

    /**
     * 幻觉检测
     */
    public function detectHallucination(string $context, string $llmOutput): array
    {
        $prompt = "上下文：{$context}\n\n"
                 . "LLM 输出：{$llmOutput}\n\n"
                 . "请评估 LLM 输出中是否存在幻觉（无中生有的信息）。\n"
                 . "返回 JSON：{\"hallucination_score\": 0-1, \"issues\": [\"问题1\", ...]}";

        $result = $this->callJudge($prompt);
        return json_decode($result, true) ?? ['hallucination_score' => 0, 'issues' => []];
    }

    /**
     * 将评估结果发送到 Phoenix
     */
    public function logEvaluation(string $traceId, string $evaluatorName, float $score, array $metadata = []): void
    {
        Http::post("{$this->phoenixEndpoint}/v1/evaluations", [
            'trace_id' => $traceId,
            'evaluator_name' => $evaluatorName,
            'score' => $score,
            'metadata' => $metadata,
        ]);
    }

    private function callJudge(string $prompt): string
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
        ])->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4',
            'messages' => [
                ['role' => 'user', 'content' => $prompt],
            ],
            'temperature' => 0.0,
            'max_tokens' => 500,
        ])->json();

        return trim($response['choices'][0]['message']['content'] ?? '');
    }
}
```

### 注册服务

在 `AppServiceProvider` 中注册 Phoenix 相关服务：

```php
<?php

namespace App\Providers;

use App\Support\Observability\PhoenixTracer;
use App\Support\Observability\PhoenixEvaluator;
use Illuminate\Support\ServiceProvider;

class PhoenixServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PhoenixTracer::class, function () {
            return new PhoenixTracer(
                endpoint: config('services.phoenix.endpoint', 'http://localhost:6006'),
            );
        });

        $this->app->singleton(PhoenixEvaluator::class, function () {
            return new PhoenixEvaluator(
                phoenixEndpoint: config('services.phoenix.endpoint', 'http://localhost:6006'),
            );
        });
    }
}
```

配置文件 `config/services.php`：

```php
'phoenix' => [
    'endpoint' => env('PHOENIX_ENDPOINT', 'http://localhost:6006'),
],
```

## Phoenix UI 使用指南

### Trace 查看

启动 Phoenix 后，访问 `http://localhost:6006`：

1. **Traces 页面**：按时间排列的所有调用链路
2. **点击某条 Trace**：展开查看每个 Span 的详细信息
3. **瀑布图**：直观看到每个阶段的耗时占比
4. **Attributes 面板**：查看 Token 用量、模型参数、输入输出

### Embedding 可视化

Phoenix 的 Embedding 可视化是杀手级功能：

1. 在代码中注册 Embedding 数据：
```python
from phoenix.inference import embed
from phoenix.dataset import Dataset

# 将你的文档向量注册到 Phoenix
ds = Dataset.from_dicts([{
    "vector": embedding_vector,
    "metadata": {"source": "doc.pdf", "chunk_id": 42},
    "text": "文档原文...",
}])
px.log_embedding_dataset(ds, "my-documents")
```

2. Phoenix 自动生成 UMAP 降维图
3. 你可以：
   - 点击查询向量，看哪些文档被检索到
   - 发现聚类异常：某些文档为什么和查询这么远？
   - 对比不同 Embedding 模型的效果

### Prompt 版本管理

Phoenix 支持 Prompt 版本化：

```python
from phoenix.prompt_templates import PromptTemplate

# 注册 Prompt 模板
template = PromptTemplate(
    name="qa-assistant",
    template="基于以下上下文回答问题：{context}\n\n问题：{question}",
    variables=["context", "question"],
)
px.log_prompt_template(template)
```

每次 Prompt 变更都会创建新版本，你可以在 UI 中对比不同版本的输出效果。

## 踩坑记录

### 1. PHP 推送 Trace 的性能问题

用 PHP 的 `Http::post()` 每次调用都发一次 HTTP 请求，在高并发场景下会拖慢业务逻辑。

**解决方案**：用队列异步推送：

```php
// 用 Laravel Queue 异步发送 Trace
dispatch(function () use ($tracer, $spanData, $startTime) {
    $tracer->sendSpan($spanData, $startTime);
})->onQueue('observability');
```

或者攒一批 Trace 批量发送（Phoenix 支持批量 API）：

```php
class TraceBatcher
{
    private array $buffer = [];
    private int $batchSize;
    private float $lastFlush = 0;

    public function __construct(int $batchSize = 50)
    {
        $this->batchSize = $batchSize;
    }

    public function add(array $span): void
    {
        $this->buffer[] = $span;
        if (count($this->buffer) >= $this->batchSize) {
            $this->flush();
        }
    }

    public function flush(): void
    {
        if (empty($this->buffer)) return;

        Http::post(config('services.phoenix.endpoint') . '/v1/traces', [
            'spans' => $this->buffer,
        ]);

        $this->buffer = [];
        $this->lastFlush = microtime(true);
    }
}
```

### 2. 中文 Prompt 在评估时的偏差

用 LLM-as-Judge 评估中文输出时，GPT-4 的评判标准可能偏向英文逻辑。

**解决方案**：在评估 Prompt 中明确要求用中文评判标准：

```php
$prompt = "你是一个中文内容质量评估专家。\n\n"
         . "请从以下维度评估：准确性、完整性、流畅性。\n"
         . "评分 0-10，给出具体理由。\n\n"
         . "内容：{$content}";
```

### 3. Trace 数据量爆炸

Phoenix 的 SQLite 后端在 Trace 量超过 10 万条后会明显变慢。

**解决方案**：

- 生产环境用 PostgreSQL
- 设置 Trace 保留策略：只保留最近 7 天的数据
- 对高频低价值的调用（如健康检查）不打 Trace

### 4. Docker 网络问题

Laravel 项目在 Docker 中运行时，`localhost:6006` 指向容器内部而非宿主机。

**解决方案**：

```yaml
# docker-compose.yml
services:
  app:
    environment:
      - PHOENIX_ENDPOINT=http://host.docker.internal:6006

  phoenix:
    ports:
      - "6006:6006"
```

## 与其他工具的对比

| 特性 | Arize Phoenix | Langfuse | LangSmith |
|------|--------------|----------|-----------|
| 开源 | ✅ | ✅ | ❌ |
| 自部署 | ✅ | ✅ | ❌ |
| Embedding 可视化 | ✅ 强 | ❌ | ❌ |
| Prompt 管理 | ✅ | ✅ | ✅ |
| 自定义评估器 | ✅ | ✅ | ✅ |
| PHP SDK | ❌ 需封装 | ✅ 官方 | ✅ 官方 |
| 社区活跃度 | 高 | 高 | 高 |

如果你的项目已经用了 Laravel + PHP，Phoenix 的优势在于：
1. Embedding 可视化对 RAG 系统调试帮助巨大
2. 开源 + 自部署，数据不出内网
3. OpenTelemetry 兼容，PHP 端自己封装比用 Langfuse 更灵活

## 总结

LLM 可观测性不是「有了更好」，而是「必须有」。当你的 Agent 系统出了问题，没有 Trace 就是在黑暗中摸索。

Phoenix 的三个核心价值：

1. **Trace**：知道每次调用发生了什么
2. **Prompt**：知道每次 Prompt 的效果如何
3. **Embedding**：知道 RAG 检索为什么好（或为什么差）

在 Laravel 项目中集成 Phoenix，核心思路是：
- 用 PHP 封装 HTTP 客户端推送 Span 数据
- 用队列异步化，不影响业务性能
- 自定义评估器量化质量

可观测性是 LLM 应用从「能跑」到「能用」的关键一步。没有 Trace 的 Agent 系统，就像没有监控的服务器——迟早出事。
