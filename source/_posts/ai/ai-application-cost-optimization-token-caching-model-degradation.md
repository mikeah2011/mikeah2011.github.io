---

title: AI 应用成本优化实战：Token 计费、缓存策略、模型降级路由
keywords: [AI, Token, 应用成本优化实战, 计费, 缓存策略, 模型降级路由]
date: 2026-06-02 03:00:00
tags:
- AI成本优化
- Token
- 缓存策略
- 模型降级
- LLM
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 这篇文章系统拆解 AI成本优化 的核心方法，从 Token计费 结构、缓存策略 设计到 模型降级 路由与预算监控，结合 LLM成本 测算公式、供应商价格对比、Laravel/PHP 实战代码与生产案例，帮助团队在保证效果与稳定性的前提下，把大模型应用从“能跑”升级为“跑得起、跑得稳、可规模化”。
---



# AI 应用成本优化实战：Token 计费、缓存策略、模型降级路由

大模型应用进入生产环境以后，团队最容易低估的往往不是模型效果，而是成本曲线。PoC 阶段几十块、几百块的调用费用，一旦叠加真实流量、复杂提示词、检索增强、工具调用、长上下文、多轮会话与日志留存，很快就会演变为每月数万元乃至数十万元的基础设施支出。更麻烦的是，AI 成本与传统 Web 服务成本不同，它并不只取决于请求数，还受到输入长度、输出长度、模型等级、命中率、路由策略、上下文拼接方式、缓存粒度、失败重试策略等多维因素影响。因此，AI 成本优化绝不是“换个便宜模型”这么简单，而是一套贯穿架构、工程、运营与监控的系统性实践。

本文围绕 AI 应用成本优化的核心主题展开，重点讨论 Token 计费、缓存策略与模型降级路由三条主线，同时延伸到监控告警、Laravel/PHP 集成和生产案例。文章目标不是给出抽象原则，而是尽量提供可以直接落地的计算方法、架构思路、配置样例与代码片段，帮助你把“成本可控”变成真正可运营、可观测、可迭代的工程能力。

---

## 一、为什么 AI 应用的成本优化要在架构初期就考虑

传统互联网系统在早期经常强调“先跑起来，再谈优化”，这在大模型应用上并不总是成立。原因在于，LLM 的边际成本通常和每次请求直接绑定。一次错误的 Prompt 设计、一次不受控的上下文膨胀、一次没有上限的重试，就会立刻体现在账单上。

一个典型的企业知识库问答系统，请求链路可能包含：

1. 用户问题预处理；
2. 生成 query embedding；
3. 向量检索；
4. 拼接系统提示词、检索片段、对话历史；
5. 调用主模型生成答案；
6. 对答案做安全审查或摘要；
7. 记录日志与会话状态。

如果每一步都调用模型，那么最终一次“问答”的真实成本可能远高于表面看到的单次 chat completion 费用。很多团队在功能验证期没有问题，但一旦进入生产，就会遇到以下现象：

- 用户量增长并不夸张，但 Token 消耗增长很快；
- 高峰期为了保可用性切换到更贵模型，账单突然上升；
- 检索增强返回内容太长，导致输入 Token 远高于输出 Token；
- 没有缓存，重复问题不断重复付费；
- 模型失败后无策略重试，造成雪崩式重复调用；
- 成本监控滞后，到月底才发现预算超支。

所以，AI 成本优化应当像数据库索引、缓存和限流一样，从系统设计第一天就纳入约束条件。一个成熟的 AI 应用，需要同时回答四个问题：

- 每个请求的成本由哪些部分构成？
- 哪些请求其实不需要重新生成？
- 哪些场景必须用大模型，哪些场景可以降级？
- 成本异常发生时，如何在分钟级发现并响应？

---

## 二、LLM 应用成本结构分析

### 2.1 成本不只是模型调用费

很多团队一提成本优化，第一反应就是“比较模型单价”。但在生产环境中，完整成本至少包括以下几个维度：

1. **输入 Token 成本**：Prompt、系统指令、历史消息、检索上下文；
2. **输出 Token 成本**：模型生成内容、结构化 JSON、推理解释；
3. **Embedding 成本**：文本向量化、索引构建、查询向量化；
4. **缓存与存储成本**：Redis、向量数据库、对象存储、日志系统；
5. **失败重试成本**：超时、429、5xx 导致的重复请求；
6. **工具链成本**：Reranker、OCR、语音转写、翻译、多模态处理；
7. **工程成本**：监控、追踪、审计、A/B 测试与离线评估；
8. **机会成本**：因为降级过度导致回答质量下降，影响转化率或满意度。

因此，真正有效的成本优化，必须把“每次请求多少钱”拆解到链路级别，而不是只看单模型报价。

### 2.2 用公式量化单次请求成本

可以先建立一个简化版成本公式：

```text
单次请求成本 = 输入Token成本 + 输出Token成本 + Embedding成本 + 额外服务成本 + 重试摊销成本
```

进一步展开：

```text
Cost(request)
= (input_tokens / 1_000_000) * input_price_per_million
+ (output_tokens / 1_000_000) * output_price_per_million
+ Σ embedding_calls
+ Σ tool_calls
+ retry_rate * avg_retry_cost
```

如果是 RAG 场景：

```text
Cost(rag_request)
= query_embedding_cost
+ retrieval_cost
+ rerank_cost(optional)
+ llm_generation_cost
+ moderation_cost(optional)
```

举个例子，假设某问答请求包含：

- 用户问题 120 tokens；
- 系统提示词 600 tokens；
- 检索片段 2200 tokens；
- 历史消息 800 tokens；
- 输出 500 tokens。

那么总输入约 3720 tokens，输出 500 tokens。如果应用每天 10 万次请求，其中 30% 是重复或高度相似的问题，而你又没有缓存，那么你相当于为大量重复价值支付重复账单。

### 2.3 成本放大的几个高频因素

#### 1）系统提示词过长

许多团队喜欢在 system prompt 中塞入冗长的规则、角色、样例、格式说明，结果每次请求都重复发送。系统提示词如果从 400 tokens 膨胀到 1800 tokens，在高并发场景下会直接放大成本。

#### 2）对话历史无限累积

聊天型产品如果不做摘要压缩或窗口裁剪，多轮上下文会不断增长。第 20 轮的成本往往不是第 1 轮的 20 倍，而是更高，因为每轮都在重复带上前文。

#### 3）RAG 检索过度召回

不是召回越多越好。很多系统 topK 设得很大，且没有 chunk 去重、长度裁剪和 rerank，导致大量边际价值很低的上下文被送进模型。

#### 4）失败重试无上限

超时后立刻原样重试 2~3 次，看似提升了成功率，实际上也会让成本翻倍。尤其在上游平台短时抖动、429 限流时，错误重试会迅速扩大账单。

#### 5）把所有任务都交给高阶模型

例如：

- 简单分类；
- 情感判断；
- 标题生成；
- 模板改写；
- FAQ 命中判断。

这些任务很多时候完全可以交给小模型、规则引擎甚至本地逻辑处理，没有必要全部走最贵模型。

---

## 三、Token 计费机制详解与平台定价对比思路

### 3.1 Token 计费的本质

大多数 LLM 平台按 Token 计费，而不是按“字数”或“请求次数”计费。Token 是模型分词器拆分后的基本单元，不同语言、不同内容结构、不同模型分词方式都会影响 Token 数量。

在中文场景里，很多工程师会误以为“一个汉字约等于一个 token”，实际上这并不稳定。数字、JSON、URL、代码片段、Markdown 表格、英文混排内容都会显著影响实际 Token 数。尤其结构化输出和长 JSON schema，常常是隐藏成本大户。

常见计费模式包括：

- 输入 Token 与输出 Token 分开计费；
- 不同模型档位有不同单价；
- 长上下文模型价格更高；
- 缓存命中 Token 可能享受更低价格或不计费；
- Batch/异步任务可能有折扣；
- Embedding 单独计费。

### 3.2 为什么输出 Token 通常更贵

在很多平台中，输出 Token 单价高于输入 Token。原因在于生成阶段需要逐 token 解码，通常比“读取输入”占用更多推理资源。因此，控制输出长度与控制输入长度同样重要。

例如，一个常见误区是给模型设置“详细解释所有步骤”，导致输出从 300 tokens 暴涨到 2000 tokens。若该回答最终只是给终端用户看，而用户其实只需要摘要，那这部分开销完全可以通过提示词约束、后处理摘要或按用户等级动态裁剪来降低。

### 3.3 平台定价对比时不要只看价格表

不同平台的定价结构可能差异很大，不能只拿“每百万 token 单价”横向比较。对比时至少应考虑：

1. **输入/输出价格比例**；
2. **上下文长度限制**；
3. **是否支持 prompt caching**；
4. **是否有 batch 折扣或吞吐套餐**；
5. **失败率、稳定性与可用区延迟**；
6. **工具调用、多模态、结构化输出是否额外收费**；
7. **是否支持企业级限流、审计和成本统计 API**。

与其给出很快过时的静态报价，不如建立“平台对比方法论”。建议将平台对比抽象成一个统一表：

| 维度 | 平台A | 平台B | 平台C |
|---|---|---|---|
| 输入单价 | x | x | x |
| 输出单价 | x | x | x |
| Embedding 单价 | x | x | x |
| 最大上下文 | x | x | x |
| 缓存机制 | 支持/不支持 | 支持/不支持 | 支持/不支持 |
| 速率限制 | x | x | x |
| 稳定性 | 高/中/低 | 高/中/低 | 高/中/低 |
| PHP SDK/HTTP 接入成本 | 低/中/高 | 低/中/高 | 低/中/高 |
| 成本统计接口 | 有/无 | 有/无 | 有/无 |

真正决策时，应该使用真实业务样本进行基准测试，而不是只看公开价格。

下面给出一个更贴近 2026 年常见商用选择的**示意性价格对比表**。注意：不同区域、企业协议、缓存折扣和批量套餐会影响最终单价，正式选型前请始终以官方 pricing 页面和实测账单为准。

| 供应商 | 代表模型 | 输入价格（USD / 1M tokens） | 输出价格（USD / 1M tokens） | 缓存输入价格（USD / 1M tokens） | 适合场景 | 选型提示 |
|---|---|---:|---:|---:|---|---|
| OpenAI | GPT-4.1 mini | 0.40 | 1.60 | 0.10 | 通用对话、轻量 RAG、结构化抽取 | 性价比较高，适合作为默认主力模型 |
| OpenAI | GPT-4.1 | 2.00 | 8.00 | 0.50 | 高质量推理、复杂工具调用 | 适合高价值链路，不建议全量直连 |
| Anthropic | Claude 3.5 Haiku | 0.80 | 4.00 | 0.08 | 摘要、客服、文档处理 | 长文本体验稳定，适合内容型工作流 |
| Google | Gemini 1.5 Flash | 0.35 | 1.05 | 0.03 | 高频问答、批量生成、多模态轻任务 | 单价低，适合高并发与实验流量 |
| 阿里云百炼 / 通义 | Qwen Turbo | 0.30 | 0.60 | 0.05 | 中文问答、企业内网应用、成本敏感场景 | 中文生态与本地化配套通常更友好 |

这个表的价值不在于“谁最便宜”，而在于帮助你快速判断：

- 哪些模型更适合作为默认层；
- 哪些模型只应放在高价值路径；
- 哪些平台的缓存折扣足以支撑 prompt caching 策略；
- 哪些业务应该优先用低成本模型做分流与预判。

### 3.4 成本测算的关键指标

建议在系统里记录以下成本字段：

```json
{
  "provider": "openai-compatible",
  "model": "gpt-4.1-mini",
  "input_tokens": 3720,
  "output_tokens": 486,
  "cached_tokens": 1200,
  "embedding_tokens": 98,
  "request_cost_usd": 0.00342,
  "route": "primary",
  "cache_hit": false,
  "retry_count": 0,
  "tenant_id": 1001,
  "feature": "knowledge_qa"
}
```

有了这些字段，后续才能做：

- 按租户统计；
- 按功能模块统计；
- 按模型版本统计；
- 按缓存命中率统计；
- 按失败重试统计；
- 按时间窗口做预算告警。

### 3.5 一个简单的 Token 成本估算器

下面用 PHP 写一个简化版成本计算器，便于在 Laravel 中统一估算账单：

```php
<?php

namespace App\Services\Ai;

class LlmCostCalculator
{
    public function estimate(array $usage, array $price): array
    {
        $inputTokens = $usage['input_tokens'] ?? 0;
        $outputTokens = $usage['output_tokens'] ?? 0;
        $cachedTokens = $usage['cached_tokens'] ?? 0;
        $embeddingTokens = $usage['embedding_tokens'] ?? 0;

        $inputCost = ($inputTokens / 1_000_000) * ($price['input_per_million'] ?? 0);
        $outputCost = ($outputTokens / 1_000_000) * ($price['output_per_million'] ?? 0);
        $cachedCost = ($cachedTokens / 1_000_000) * ($price['cached_input_per_million'] ?? 0);
        $embeddingCost = ($embeddingTokens / 1_000_000) * ($price['embedding_per_million'] ?? 0);

        $total = round($inputCost + $outputCost + $cachedCost + $embeddingCost, 8);

        return [
            'input_cost' => round($inputCost, 8),
            'output_cost' => round($outputCost, 8),
            'cached_cost' => round($cachedCost, 8),
            'embedding_cost' => round($embeddingCost, 8),
            'total_cost' => $total,
        ];
    }
}
```

在工程里你不一定每次都能从供应商直接拿到成本值，因此保留一个内部估算器非常有用，便于做预算预测与对账。

---

## 四、缓存策略：语义缓存、响应缓存、Embedding 缓存

缓存是 AI 成本优化里性价比最高的工程手段之一。因为很多请求并不是“必须重新推理”的。只要设计得当，缓存不仅能降低成本，还能改善响应延迟与稳定性。

但 AI 缓存和传统 Web 缓存不完全一样。传统缓存往往按 URL 或 Key 精确命中，而 AI 请求存在“语义相似但文本不同”的情况，所以需要分层设计。

### 4.1 缓存分层思路

建议至少设计三层缓存：

1. **响应缓存（Response Cache）**：完全相同请求直接返回结果；
2. **语义缓存（Semantic Cache）**：相似问题命中历史答案；
3. **Embedding 缓存（Embedding Cache）**：相同文本不重复做向量化。

如果系统规模更大，还可以加入：

- Prompt 片段缓存；
- RAG 检索结果缓存；
- 工具调用结果缓存；
- 系统提示词哈希缓存。

### 4.2 响应缓存：最低成本、最容易落地

响应缓存适合以下场景：

- FAQ 问答；
- 标准化文案生成；
- 模板转换；
- 相同参数的结构化提取；
- 后台批量任务的重复文本处理。

核心做法是：对请求参数做规范化，然后计算哈希作为缓存 Key。

```php
<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Cache;

class AiResponseCache
{
    public function remember(string $feature, array $payload, int $ttl, callable $callback): array
    {
        $normalized = $this->normalizePayload($payload);
        $key = 'ai:response:' . $feature . ':' . hash('sha256', json_encode($normalized, JSON_UNESCAPED_UNICODE));

        return Cache::remember($key, $ttl, $callback);
    }

    private function normalizePayload(array $payload): array
    {
        ksort($payload);

        if (isset($payload['messages'])) {
            $payload['messages'] = array_map(function ($message) {
                return [
                    'role' => $message['role'] ?? 'user',
                    'content' => trim((string)($message['content'] ?? '')),
                ];
            }, $payload['messages']);
        }

        return $payload;
    }
}
```

响应缓存的难点不是技术，而是 **Key 规范化**。如果你的 payload 中包含时间戳、trace_id、随机温度参数、无意义空格，那么命中率会被显著拉低。

下面再给一个更接近生产环境的“成本感知缓存”示例：只有当请求满足可缓存条件时才进入缓存，并把命中节省的 Token 与成本一起记录下来，便于后续做 ROI 分析。

```php
<?php

namespace App\Services\Ai;

use Illuminate\Contracts\Cache\Repository as CacheRepository;

class CostAwareAiCacheService
{
    public function __construct(
        private CacheRepository $cache,
        private LlmCostCalculator $costCalculator,
    ) {
    }

    public function rememberCompletion(string $feature, array $payload, array $price, callable $resolver): array
    {
        $normalized = $this->normalizePayload($payload);
        $fingerprint = hash('sha256', json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $key = sprintf('ai:completion:%s:%s:v%s', $feature, $fingerprint, $payload['prompt_version'] ?? '1');
        $ttl = $this->ttlFor($feature);

        $cached = $this->cache->get($key);
        if (is_array($cached)) {
            $cached['meta']['cache_hit'] = true;
            $cached['meta']['avoided_cost'] = $this->costCalculator->estimate([
                'input_tokens' => $cached['meta']['input_tokens'] ?? 0,
                'output_tokens' => $cached['meta']['output_tokens'] ?? 0,
                'cached_tokens' => $cached['meta']['cached_tokens'] ?? 0,
            ], $price)['total_cost'];

            return $cached;
        }

        $response = $resolver($normalized);

        if ($this->shouldCache($feature, $normalized, $response)) {
            $response['meta']['cache_hit'] = false;
            $response['meta']['cached_at'] = now()->toIso8601String();

            $this->cache->put($key, $response, now()->addSeconds($ttl));
        }

        return $response;
    }

    private function shouldCache(string $feature, array $payload, array $response): bool
    {
        if (!empty($payload['stream'])) {
            return false;
        }

        if (($response['meta']['finish_reason'] ?? null) === 'length') {
            return false;
        }

        return in_array($feature, ['faq', 'knowledge_qa', 'ticket_summary'], true)
            && !empty($response['content'])
            && mb_strlen($response['content']) >= 20;
    }

    private function ttlFor(string $feature): int
    {
        return match ($feature) {
            'faq' => 86400 * 7,
            'knowledge_qa' => 86400,
            default => 3600,
        };
    }

    private function normalizePayload(array $payload): array
    {
        unset($payload['trace_id'], $payload['request_id'], $payload['timestamp']);

        ksort($payload);

        if (isset($payload['messages']) && is_array($payload['messages'])) {
            $payload['messages'] = array_map(static function (array $message): array {
                return [
                    'role' => $message['role'] ?? 'user',
                    'content' => trim((string) ($message['content'] ?? '')),
                ];
            }, $payload['messages']);
        }

        return $payload;
    }
}
```

这个实现比简单 `Cache::remember()` 更实用的地方在于：

- 会过滤掉不适合缓存的流式响应和截断响应；
- 将 `prompt_version` 纳入 Key，避免 Prompt 升级后误命中旧答案；
- 在命中时回填 `avoided_cost`，方便统计缓存到底帮你省了多少钱；
- 可以按功能模块配置不同 TTL，而不是“一把梭”统一过期时间。

### 4.3 语义缓存：把“相似问题”变成可复用资产

语义缓存适合客服、企业知识助手、文档问答、站内搜索建议等高重复语义场景。它的核心思想是：

- 将用户问题向量化；
- 在历史问答缓存库中做相似度检索；
- 如果相似度高于阈值，直接返回历史答案或轻微改写后的答案。

典型架构：

```text
用户问题
  -> 计算 embedding
  -> 查询 semantic_cache index
  -> 相似度 > 阈值 ?
        是 -> 返回缓存答案
        否 -> 调用 LLM 生成 -> 写入语义缓存
```

一个非常实用的优化是把语义缓存与租户、语言、业务场景绑定。比如：

```text
semantic_cache:{tenant_id}:{locale}:{feature}
```

这样可以避免不同业务线之间互相污染。

#### 语义缓存阈值怎么设？

常见经验：

- 0.95+：适合标准 FAQ，命中精度高；
- 0.90~0.95：适合知识问答，需要配合人工验证；
- 0.85~0.90：适合建议类场景，但误命中风险上升。

不要只追求高命中率。语义缓存命中错一次，往往比多花一次模型费更伤用户体验。生产上建议采用“双阈值策略”：

- 高阈值：直接返回；
- 中阈值：进入轻量模型验证；
- 低阈值：正常走主链路。

### 4.4 Embedding 缓存：常被忽视，但非常划算

很多团队把重心都放在生成模型成本上，却忽略了 embedding 调用的累计支出。尤其在以下场景：

- 文档重复导入；
- 多租户共享知识库片段；
- 热门查询反复向量化；
- 批处理数据反复计算 embedding。

Embedding 缓存适合用文本规范化 + 哈希方式处理：

```php
<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Cache;

class EmbeddingCacheService
{
    public function getOrCreate(string $text, callable $resolver, int $ttl = 604800): array
    {
        $normalized = $this->normalize($text);
        $key = 'ai:embedding:' . hash('sha256', $normalized);

        return Cache::remember($key, $ttl, function () use ($resolver, $normalized) {
            return $resolver($normalized);
        });
    }

    private function normalize(string $text): string
    {
        $text = trim($text);
        $text = preg_replace('/\s+/u', ' ', $text);
        return mb_strtolower($text);
    }
}
```

对于知识库切片场景，建议同时保存：

- 文本哈希；
- embedding 模型版本；
- 向量维度；
- 生成时间；
- 文本来源。

因为 embedding 模型升级后，老缓存未必还能和新向量空间兼容，需要做版本隔离。

### 4.5 缓存失效策略设计

AI 缓存最大的问题之一，是“何时失效”。和静态网页不同，大模型输出可能会过时、带有上下文依赖，或者受业务知识变更影响。

常见失效策略包括：

1. **TTL 过期**：简单易控，适合 FAQ、通用文案；
2. **版本失效**：Prompt、模型、知识库版本变化后整体失效；
3. **事件驱动失效**：文档更新、价格变更、政策更新后定向删除；
4. **质量反馈失效**：用户点踩、人工审核失败后淘汰缓存；
5. **命中衰减**：长期无人命中的缓存自动清理。

生产上往往会组合使用。例如，知识问答缓存可以采用：

```text
TTL = 24小时
+ 文档版本变化立即失效
+ 命中次数低于阈值的缓存 7 天清理
```

### 4.6 缓存收益如何量化

不要只上缓存，还要证明缓存真的值。建议记录：

- cache_hit_rate；
- semantic_cache_hit_rate；
- avoided_input_tokens；
- avoided_output_tokens；
- avoided_cost；
- cache_false_hit_count；
- verification_pass_rate。

一旦这些指标可视化，就可以很直观地看到：

- 哪个功能最适合做缓存；
- 哪类请求命中率最高；
- 命中阈值调高或调低后，成本与质量怎么变化。

---

## 五、模型降级路由：降级链、负载均衡与智能路由

模型降级不是“出了问题随便换个便宜模型”，而是基于业务目标、延迟、预算和质量约束做策略性路由。优秀的路由系统，能让 20% 的高复杂请求走高阶模型，80% 的普通请求走低成本模型，从而大幅优化整体成本结构。

### 5.1 为什么必须做模型分层

现实业务中的请求复杂度高度不均衡。举例来说：

- “帮我写一封请假邮件”这种生成任务，对推理能力要求很低；
- “根据合同条款比较违约责任差异并列出风险点”则需要更强理解能力；
- “从工单中提取工单编号、优先级、处理人”甚至可以用规则 + 小模型完成。

如果所有请求都直接打到旗舰模型，那你在为大量低复杂度任务支付高复杂度价格。

### 5.2 常见降级路由模式

#### 模式一：固定降级链

最简单的做法是定义优先级链路：

```text
旗舰模型 -> 中档模型 -> 轻量模型 -> 规则模板
```

触发条件可以是：

- 请求失败；
- 超时；
- 预算超限；
- 高峰期限流；
- 非关键场景；
- 用户套餐级别较低。

Laravel 中可以这样定义：

```php
<?php

return [
    'routes' => [
        'knowledge_qa' => [
            'primary' => 'gpt-4.1',
            'fallbacks' => ['gpt-4.1-mini', 'gpt-4o-mini'],
        ],
        'ticket_summary' => [
            'primary' => 'gpt-4.1-mini',
            'fallbacks' => ['gpt-4o-mini', 'local-template'],
        ],
    ],
];
```

#### 模式二：负载均衡路由

当同等级模型来自不同供应商或不同区域时，可以做加权分流：

- 70% 流量走性价比更高的平台；
- 20% 流量走稳定性更好的主平台；
- 10% 流量走实验模型用于效果评估。

这样既能控制成本，也能降低单一供应商故障风险。

#### 模式三：智能路由

智能路由会先判断任务复杂度，再选择模型。判断依据可能包括：

- prompt 长度；
- 是否需要工具调用；
- 是否需要长上下文；
- 是否要求 JSON 严格输出；
- 历史质量反馈；
- 用户等级；
- 预算余量。

一个简单的智能路由评分器：

```php
<?php

namespace App\Services\Ai;

class ModelRouter
{
    public function route(array $context): string
    {
        $score = 0;

        $score += min(($context['input_tokens'] ?? 0) / 1000, 5);
        $score += !empty($context['requires_reasoning']) ? 3 : 0;
        $score += !empty($context['requires_tools']) ? 2 : 0;
        $score += !empty($context['strict_json']) ? 1 : 0;
        $score += !empty($context['vip_user']) ? 1 : 0;

        if (($context['budget_pressure'] ?? false) === true) {
            $score -= 2;
        }

        return match (true) {
            $score >= 7 => 'gpt-4.1',
            $score >= 4 => 'gpt-4.1-mini',
            default => 'gpt-4o-mini',
        };
    }
}
```

这个例子比较粗糙，但它展示了一个核心思想：**不要根据“功能名”做粗暴路由，而要根据请求特征做动态路由。**

### 5.3 降级不仅是模型切换，还包括能力降级

很多时候，真正有效的降级不是从 A 模型切到 B 模型，而是减少任务复杂度，例如：

- 长文总结降级为短摘要；
- 结构化抽取只保留核心字段；
- 多轮对话降级为单轮问答；
- RAG topK 从 8 降到 3；
- 停用 rerank；
- 限制最大输出 token。

这类“能力降级”往往比“模型降级”更平滑，也更容易向业务解释。

### 5.4 路由中的风险控制

降级系统最怕两个问题：

1. 省了成本，但质量崩了；
2. 为了保质量，结果高阶模型占比并没有降下来。

因此需要定义清晰的策略边界：

- 哪些场景绝不能降级，例如法律审核、财务审批建议；
- 哪些输出必须结构化校验，不合格自动升级；
- 哪些用户属于高 SLA 人群，不参与激进降级；
- 哪些时间窗口允许预算驱动的强降级。

### 5.5 一个可落地的降级链实现样例

```php
<?php

namespace App\Services\Ai;

use Throwable;

class FallbackCompletionService
{
    public function __construct(private array $clients)
    {
    }

    public function complete(array $messages, array $models): array
    {
        $errors = [];

        foreach ($models as $model) {
            try {
                $response = $this->clients[$model]->chat($messages, [
                    'max_tokens' => $this->maxTokensFor($model),
                    'temperature' => $this->temperatureFor($model),
                ]);

                if ($this->isAcceptable($response)) {
                    $response['routed_model'] = $model;
                    return $response;
                }

                $errors[] = "{$model}: unacceptable response";
            } catch (Throwable $e) {
                $errors[] = "{$model}: {$e->getMessage()}";
            }
        }

        return [
            'content' => '当前服务繁忙，请稍后重试。',
            'routed_model' => 'static-fallback',
            'errors' => $errors,
        ];
    }

    private function maxTokensFor(string $model): int
    {
        return match ($model) {
            'gpt-4.1' => 1200,
            'gpt-4.1-mini' => 800,
            default => 400,
        };
    }

    private function temperatureFor(string $model): float
    {
        return match ($model) {
            'gpt-4.1' => 0.3,
            default => 0.2,
        };
    }

    private function isAcceptable(array $response): bool
    {
        return !empty($response['content']) && mb_strlen($response['content']) >= 20;
    }
}
```

这个实现的关键点在于：

- 每级模型有自己的输出限制；
- 响应质量不达标可以继续降级或升级；
- 最后总有一个静态保底结果；
- 错误链路会被记录，便于回溯与监控。

---

## 六、成本监控与告警系统设计

如果没有监控，所谓“成本优化”往往只是一次性动作，而不是长期可运营机制。生产系统至少需要做到：

- 看到每个模型、每个功能、每个租户的成本；
- 发现异常飙升；
- 找到是输入膨胀、输出失控、缓存失效还是重试过多；
- 能在预算超支前自动响应。

### 6.1 监控指标设计

建议分成四层指标。

#### 第一层：基础调用指标

- request_count
- success_rate
- error_rate
- timeout_rate
- retry_count
- p95_latency

#### 第二层：Token 指标

- input_tokens_total
- output_tokens_total
- avg_input_tokens
- avg_output_tokens
- cached_tokens_total
- embedding_tokens_total

#### 第三层：成本指标

- total_cost
- cost_by_model
- cost_by_feature
- cost_by_tenant
- cost_per_request
- avoided_cost_by_cache

#### 第四层：路由与缓存指标

- primary_model_ratio
- fallback_model_ratio
- semantic_cache_hit_rate
- response_cache_hit_rate
- route_upgrade_rate
- route_degrade_rate

### 6.2 告警策略不要只设“总成本超限”

单一预算告警太晚。建议至少设置以下规则：

1. **小时级成本突增**：近 1 小时费用 > 近 7 天同小时均值 2 倍；
2. **平均输入 Token 异常**：avg_input_tokens 持续 15 分钟高于基线 50%；
3. **缓存命中率骤降**：response_cache_hit_rate 从 40% 降到 10%；
4. **高阶模型占比飙升**：primary flagship ratio 异常升高；
5. **重试成本放大**：retry_count 在短时窗口陡增；
6. **单租户预算超额**：tenant 日预算或月预算超限。

### 6.3 成本事件日志表示例

```sql
CREATE TABLE ai_cost_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    feature VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    route VARCHAR(50) NOT NULL,
    request_id CHAR(36) NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    embedding_tokens INT NOT NULL DEFAULT 0,
    request_cost DECIMAL(12,8) NOT NULL DEFAULT 0,
    cache_hit TINYINT(1) NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_feature_created (tenant_id, feature, created_at),
    INDEX idx_model_created (model, created_at)
);
```

有了这张表，就可以很方便地做 BI 看板与预算统计。

### 6.4 Laravel 中的中间件/事件埋点

```php
<?php

namespace App\Listeners;

use App\Events\AiRequestCompleted;
use App\Models\AiCostEvent;

class RecordAiCostEvent
{
    public function handle(AiRequestCompleted $event): void
    {
        AiCostEvent::create([
            'tenant_id' => $event->tenantId,
            'feature' => $event->feature,
            'provider' => $event->provider,
            'model' => $event->model,
            'route' => $event->route,
            'request_id' => $event->requestId,
            'input_tokens' => $event->usage['input_tokens'] ?? 0,
            'output_tokens' => $event->usage['output_tokens'] ?? 0,
            'cached_tokens' => $event->usage['cached_tokens'] ?? 0,
            'embedding_tokens' => $event->usage['embedding_tokens'] ?? 0,
            'request_cost' => $event->cost['total_cost'] ?? 0,
            'cache_hit' => $event->cacheHit,
            'latency_ms' => $event->latencyMs,
            'retry_count' => $event->retryCount,
        ]);
    }
}
```

### 6.5 预算控制的自动化动作

告警不仅要“通知”，还要触发动作。例如：

- 单租户预算达到 80%：降低默认模型等级；
- 达到 100%：切换到低成本模式；
- 高峰限流时：减少 max_tokens、关闭思维链输出；
- 缓存命中率异常下降：自动回滚最近 Prompt 变更；
- 某供应商 5xx 飙升：路由切换到备用供应商。

这才是一个闭环系统，而不是单纯的看板展示。

---

## 七、Laravel/PHP 集成中的成本控制实战

很多中文开发团队在业务系统中使用 Laravel/PHP 接 AI 服务。虽然主流生态常以 Python 为例，但实际上在 PHP 中同样可以做出非常精细的成本控制体系。

### 7.1 配置中心：把模型、限额、阈值放进配置层

建议统一在配置文件中维护：

```php
<?php

return [
    'default_provider' => env('AI_PROVIDER', 'openai-compatible'),

    'models' => [
        'premium' => env('AI_MODEL_PREMIUM', 'gpt-4.1'),
        'standard' => env('AI_MODEL_STANDARD', 'gpt-4.1-mini'),
        'economy' => env('AI_MODEL_ECONOMY', 'gpt-4o-mini'),
    ],

    'budgets' => [
        'daily_usd' => (float) env('AI_DAILY_BUDGET', 100),
        'monthly_usd' => (float) env('AI_MONTHLY_BUDGET', 2000),
    ],

    'cache' => [
        'response_ttl' => 3600,
        'semantic_threshold' => 0.93,
        'embedding_ttl' => 604800,
    ],

    'limits' => [
        'max_input_tokens' => 8000,
        'max_output_tokens' => 1200,
        'max_retries' => 1,
    ],
];
```

把这些策略配置化，而不是硬编码在业务逻辑里，后续调优会轻松很多。

### 7.2 请求前做预算和复杂度预判

在发起模型调用前，可以先做三件事：

1. 估算 token；
2. 判断是否命中缓存；
3. 判断当前预算压力和路由策略。

```php
<?php

namespace App\Services\Ai;

class AiGateway
{
    public function handle(array $payload): array
    {
        $estimatedTokens = $this->estimateTokens($payload);

        if ($estimatedTokens['input'] > config('ai.limits.max_input_tokens')) {
            $payload = $this->truncateContext($payload);
        }

        if ($cached = $this->responseCache->lookup('chat', $payload)) {
            $cached['meta']['source'] = 'response_cache';
            return $cached;
        }

        $model = $this->router->route([
            'input_tokens' => $estimatedTokens['input'],
            'requires_reasoning' => $payload['requires_reasoning'] ?? false,
            'budget_pressure' => $this->budgetService->isUnderPressure(),
        ]);

        return $this->clientFactory->for($model)->chat($payload);
    }
}
```

### 7.3 控制对话上下文膨胀

聊天系统成本失控，经常是因为历史消息无限累积。一个实战做法是“窗口 + 摘要双轨制”：

- 最近 N 轮原文保留；
- 更早历史压缩为摘要；
- 摘要长度设硬上限；
- 关键信息单独做结构化 memory，而不是全靠自然语言上下文。

```php
<?php

class ConversationContextBuilder
{
    public function build(array $messages, ?string $summary): array
    {
        $recent = array_slice($messages, -6);
        $context = [];

        if ($summary) {
            $context[] = [
                'role' => 'system',
                'content' => '以下是历史对话摘要，请作为上下文参考：' . $summary,
            ];
        }

        return array_merge($context, $recent);
    }
}
```

这类方案对成本影响很明显，因为它能避免多轮对话进入指数级输入膨胀。

### 7.4 控制结构化输出成本

很多业务喜欢让模型返回非常复杂的 JSON。问题在于：

- schema 提示很长；
- 输出字段很多；
- 模型需要为每个字段生成键和值；
- 错误修复重试成本高。

优化建议：

- 只保留真正会被使用的字段；
- 将大文本字段改为引用 ID 或摘要；
- 对枚举字段尽量短；
- 使用后处理补默认值，而不是要求模型全量生成。

例如，不要这样：

```json
{
  "classification_reason": "非常长的解释...",
  "possible_department_candidates": ["研发中心", "市场中心", "法务部"],
  "detailed_priority_explanation": "..."
}
```

如果业务真正需要的只有：

```json
{
  "department": "法务部",
  "priority": "P1"
}
```

那就不要强迫模型做额外输出。

### 7.5 队列化与批量处理

离线任务例如：

- 批量摘要；
- 工单标签提取；
- 评论分析；
- 文档 embedding 建库。

这类任务尽量放到 Laravel Queue 中异步处理，并在任务层支持：

- 批量聚合；
- 慢速低价模型；
- 失败指数退避；
- 夜间低峰期运行；
- 成本上限熔断。

```php
<?php

class ProcessTicketSummaryJob implements ShouldQueue
{
    public int $tries = 2;

    public function handle(): void
    {
        if (app(BudgetService::class)->isOverDailyBudget()) {
            return;
        }

        app(TicketSummaryService::class)->process($this->ticketId, [
            'model' => config('ai.models.economy'),
            'max_tokens' => 300,
        ]);
    }
}
```

### 7.6 PHP 侧的一个经验：不要把成本控制散落在 Controller

很多项目一开始直接在 Controller 中调模型，后面逐步加缓存、加预算、加路由、加审计，最后逻辑变得混乱。建议至少抽象以下层次：

- `AiGateway`：统一入口；
- `ModelRouter`：选择模型；
- `CostCalculator`：估算与记录成本；
- `CacheService`：响应缓存、语义缓存、embedding 缓存；
- `BudgetService`：预算策略；
- `PromptBuilder`：提示词与上下文管理；
- `UsageRecorder`：埋点与监控。

这样做的价值在于：当你需要切换供应商、修改阈值、增加降级链时，不必重构整个业务代码。

---

## 八、生产环境成本优化案例

下面给出几个典型案例，帮助理解各种策略如何组合落地。

### 案例一：企业知识库问答系统

#### 初始状态

- 日请求量：8 万；
- 主模型：统一使用高阶模型；
- RAG topK=8；
- 无缓存；
- 多轮对话历史原样拼接；
- 月成本持续超预算。

#### 发现的问题

1. 输入 token 占总成本 78%；
2. 其中检索片段与历史消息是主要膨胀来源；
3. 热门问题重复率很高；
4. 大部分问题其实不需要旗舰模型。

#### 优化动作

- 增加响应缓存与语义缓存；
- 引入对话摘要机制，最近 6 轮 + 历史摘要；
- RAG topK 从 8 降到 4，并做 chunk 去重；
- 将简单 FAQ 路由到经济模型；
- 对长回答设定 `max_tokens=500`；
- 增加成本看板与租户预算控制。

#### 优化结果

- 缓存命中率提升到 34%；
- 平均输入 token 下降 41%；
- 高阶模型占比从 100% 降到 28%；
- 月成本下降约 52%；
- 平均响应时间反而下降约 35%。

这个案例说明，成本优化和性能优化并不冲突，缓存和上下文裁剪经常能同时改善两者。

### 案例二：客服工单分类与摘要

#### 初始状态

客服系统每条工单都调用一个较强模型完成：

- 分类；
- 优先级判断；
- 摘要生成；
- 建议回复草稿。

#### 优化思路

将任务拆分：

- 分类和优先级判断：小模型 + 规则；
- 摘要：经济模型；
- 仅当置信度低时，才升级到高阶模型；
- 建议回复草稿仅对人工座席打开，不在所有工单上默认生成。

#### 成果

- 每单平均成本下降 63%；
- 低置信度升级率仅 9%；
- 座席满意度没有明显下降。

这个案例的启发是：**不要把一个复杂任务当作不可拆分的整体。** 拆分后，各子任务可以匹配不同成本档位。

### 案例三：内容运营平台批量改写

#### 痛点

夜间批量处理 20 万篇内容，账单波动大，失败重试频繁。

#### 方案

- 全部异步队列化；
- 相同原文先做哈希去重；
- 模板型任务优先走规则引擎；
- 非关键字段不要求生成；
- 批量任务仅使用经济模型；
- 失败后指数退避，并限制最大重试 1 次；
- 夜间窗口运行，超过预算自动暂停队列。

#### 结果

- 重复处理减少 22%；
- 重试成本下降 70%+；
- 日处理成本更稳定，可预测性显著提升。

---

## 九、最佳实践与踩坑记录

最后总结一些在 AI 成本优化中非常常见、但又容易被忽略的经验。

### 9.1 最佳实践

#### 1）把成本当成一等公民指标

和延迟、可用性一样，成本必须进入 dashboard、告警和周报。没有持续可见性，就没有真正的优化。

#### 2）优先优化输入 token，而不是只盯输出

在很多 RAG 和多轮对话场景中，输入 token 才是最大头，特别是系统提示词、检索上下文和历史消息。

#### 3）缓存一定要做分层

响应缓存、语义缓存、embedding 缓存解决的是不同问题。不要试图用一种缓存策略包打天下。

#### 4）模型路由要“按任务复杂度”而非“按功能名”

同一个功能下，请求难度可能差异很大。动态路由比静态绑定更省钱。

#### 5）把失败重试纳入成本预算

如果一个请求单价是 1，而失败后平均重试 1.5 次，那么真实成本不是 1，而是更高。重试必须有上限、有退避、有熔断。

#### 6）对 Prompt 做版本管理

Prompt 改动常常直接影响 token 长度、缓存命中率和模型选择。建议像代码一样给 Prompt 编版本号，发生成本异常时更容易定位。

#### 7）把“质量守门”放在降级链中

不能只看成本下降。必须设计质量阈值、结构化校验、人工抽检或离线评估，避免成本下降但业务指标恶化。

### 9.2 常见踩坑

#### 坑一：缓存命中率很低，却不知道为什么

原因往往是 payload 没规范化，比如：

- 动态时间戳混入；
- trace_id 混入；
- 空格和换行不一致；
- temperature 随机波动；
- Prompt 版本未纳入 key。

#### 坑二：语义缓存误命中，用户投诉答案不对

这是阈值过低或租户隔离不足导致的。必须引入高阈值命中、二次验证、业务域隔离。

#### 坑三：只看供应商价格表，忽略稳定性

如果便宜平台失败率高、429 多、超时多，你省下的单价可能会被重试和降级链消耗掉。

#### 坑四：预算控制只在月底看账单

这太晚了。生产上要做到小时级观察、日级预算、租户级限额。

#### 坑五：为了省钱把所有场景都切到小模型

结果用户体验显著下降，转化率变差，最终“节省的 API 成本”被“业务损失”抵消。成本优化不是单一目标优化，而是质量、速度、成本之间的平衡。

#### 坑六：Embedding 模型升级却没做版本隔离

导致新老向量混用，召回质量下降，团队误以为是生成模型变差，实际上是向量空间不一致。

#### 坑七：没有给 max_tokens 设置上限

输出过长是很多账单异常的直接原因。尤其在摘要、分类、结构化任务中，严格限制输出长度几乎总是值得的。

---

## 十、一个推荐的 AI 成本优化落地路线图

如果你现在要把一个已经上线的大模型应用做系统性成本优化，可以按以下顺序推进：

### 第一步：先建立观测能力

至少记录：

- 模型；
- 输入/输出 token；
- 成本估算；
- 功能模块；
- 用户/租户；
- 缓存命中；
- 路由结果；
- 重试次数。

### 第二步：识别前 20% 的高成本路径

找到最烧钱的几个功能，不要试图同时优化所有场景。通常前几个高流量、高 token 模块就贡献了大部分成本。

### 第三步：先做低风险优化

优先级通常是：

1. 限制 max_tokens；
2. 裁剪上下文；
3. 做精确响应缓存；
4. 做 embedding 缓存；
5. 控制重试。

这些动作风险低、见效快。

### 第四步：再做语义缓存与模型路由

这两项收益大，但需要更多质量验证和监控。建议从重复问题多、结果标准化程度高的模块开始。

### 第五步：预算闭环自动化

最后把成本告警、降级策略、限额开关和运营通知打通，形成自动控制系统。

---

## 结语

AI 应用成本优化不是一次性的“降本项目”，而是一种长期工程能力。真正成熟的团队，会把 Token 计费理解为基础度量，把缓存视为核心基础设施，把模型降级路由当作流量调度系统，把成本监控纳入生产治理闭环。

如果要用一句话概括本文的核心观点，那就是：**AI 成本不是靠单点技巧压下去的，而是靠可观测、可缓存、可路由、可降级的系统设计管出来的。**

在实践中，你通常会发现最有效的手段并不是某一个“神奇便宜模型”，而是以下组合拳：

- 控制输入上下文长度；
- 限制输出规模；
- 提高缓存命中率；
- 根据任务复杂度路由模型；
- 建立实时预算与告警；
- 在业务代码中将成本控制显式化。

当这些能力逐步成熟后，你的 AI 应用就能从“能跑”升级为“跑得起、跑得稳、还能规模化扩张”。这也是所有走向生产的大模型系统最终都必须补上的一课。

## 相关阅读

- [AI Agent + Laravel 实战：从接口集成到可落地工作流](/categories/AI%20Agent/AI-Agent-Laravel-LLM-Integration/)
- [RAG 系统实战：向量数据库、Chunking 与 Retrieval 设计](/categories/AI%20Agent/RAG-Vector-DB-Chunking-Retrieval/)
- [Dify 实战：低代码 AI 工作流平台上手指南](/categories/AI/dify-workflow-guide-low-code-ai-platform/)
- [AI Agent 可观测性：LangSmith、Langfuse、Tracing 与评估体系](/categories/AI/ai-agent-observability-langsmith-langfuse-tracing-evaluation/)
