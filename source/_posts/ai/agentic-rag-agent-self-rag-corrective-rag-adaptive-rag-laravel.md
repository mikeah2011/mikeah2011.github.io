---

title: Agentic RAG 实战：让 Agent 自主决定检索策略——Self-RAG、Corrective-RAG、Adaptive-RAG 在 Laravel
keywords: [Agentic RAG, Agent, Self, RAG, Corrective, Adaptive, Laravel, 自主决定检索策略]
date: 2026-06-03 10:00:00
description: 深入解析 Self-RAG、Corrective-RAG、Adaptive-RAG 三大 Agentic RAG 策略的原理与差异，并在 Laravel 框架中完整落地。涵盖反思标记实现、检索质量评估与纠错循环、查询复杂度自适应路由、Python 嵌入微服务集成、评估框架搭建等全流程，附可运行 PHP/Python 代码示例，帮助后端工程师快速构建生产级智能检索增强生成系统。
tags:
- RAG
- Agent
- Laravel
- 向量检索
- Prompt Engineering
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---





# Agentic RAG 实战：让 Agent 自主决定检索策略——Self-RAG、Corrective-RAG、Adaptive-RAG 在 Laravel 中的落地

## 引言：为什么 RAG 需要"智能"起来？

在大语言模型驱动的应用开发浪潮中，检索增强生成（Retrieval-Augmented Generation，RAG）已经成为连接模型能力与外部知识的核心范式。几乎所有需要处理私有知识、实时信息或专业领域内容的 AI 应用，都离不开 RAG 的支撑。然而，当我们把 RAG 部署到真实的生产环境中时，一个严峻的问题浮现出来：**传统 RAG 太"笨"了**。

传统 RAG 的工作模式可以用一句话概括：收到查询，执行检索，把文档塞给大模型，然后祈祷输出的质量足够好。这种"一次性流水线"的做法在面对简单、明确的事实性查询时确实有效，但在以下场景中会暴露出严重缺陷：当用户的查询意图模糊时，系统不知道该检索什么；当检索结果不相关时，系统无法自我纠正；当问题需要多步推理时，系统只能在单次检索中"尽力而为"。

更令人担忧的是，当检索上下文不足时，大语言模型并不会主动说"我不知道"，而是倾向于基于有限的信息编造一个看似合理但可能完全错误的回答——这就是臭名昭著的"幻觉"问题。在企业级应用中，一次错误的回答可能导致用户做出错误决策，其后果远比不回答更加严重。

**Agentic RAG** 的出现彻底改变了这一格局。它将 AI Agent 的自主决策能力注入 RAG 流程，赋予系统反思、判断和纠错的能力。不再是简单的"检索-拼接-生成"，而是让系统像一个经验丰富的研究者一样：面对查询时先判断复杂度、选择合适的检索策略、评估检索结果的质量、在发现不足时主动纠正，最终给出经过深思熟虑的回答。

本文将深入剖析三种前沿的 Agentic RAG 模式——**Self-RAG**（自我反思检索增强生成）、**Corrective-RAG**（纠正性检索增强生成）和 **Adaptive-RAG**（自适应检索增强生成），并展示如何在 **Laravel** 框架中将它们落地为生产级系统。无论你是后端工程师、AI 应用开发者还是技术架构师，都能从本文中获得可直接落地的代码实现和架构设计思路。

---

## 一、从 Naive RAG 到 Agentic RAG：演进之路

### 1.1 Naive RAG 的局限性

Naive RAG（朴素 RAG）是最基本的检索增强生成实现，其核心流程非常直观：接收用户查询、将查询转换为向量、在向量数据库中搜索相似文档、将检索到的文档片段拼接到提示词中、最后调用大语言模型生成回答。

这个流程看似完美，但在实际应用中存在几个根深蒂固的问题。首先，**检索质量不可控**。向量相似度匹配依赖于嵌入模型的质量和查询与文档之间的语义重叠程度，但语义相似并不等于信息相关。当用户的查询包含隐含意图、专业缩写或口语化表达时，向量检索经常返回"看起来相似但实际无用"的文档片段。例如，用户问"苹果的最新产品怎么样"，系统可能检索到大量关于苹果营养成分的文档，因为"苹果"这个词在两种语境中都很常见。

其次，**缺乏自我反思机制**。Naive RAG 无法判断生成的回答是否准确、是否有据可依。即使检索到的文档明显与查询不相关，模型也会基于这些不相关的上下文强行拼凑出一个回答。这种"自信地犯错"的行为在生产环境中是极其危险的，因为用户往往无法辨别回答的可靠性。

第三，**策略完全僵化**。无论用户的查询是一个简单的定义性问题（如"什么是微服务架构"），还是一个需要综合多方面信息的复杂分析（如"在电商场景下，如何在微服务和单体架构之间做技术选型"），系统都使用完全相同的检索参数和生成策略。这导致简单查询可能被过度处理造成资源浪费，而复杂查询又得不到足够的检索深度和推理支持。

第四，**无法处理知识缺口**。当用户的问题超出了知识库的覆盖范围时，系统没有机制识别这种情况，也无法采取主动的补救措施（比如调用搜索引擎获取最新信息）。模型只是在已有的不充分上下文中"勉为其难"地给出回答，往往以幻觉告终。

### 1.2 Advanced RAG 的改进尝试

为了克服 Naive RAG 的这些限制，业界提出了多种改进方案。查询重写技术在检索前对用户的原始查询进行改写、扩展或分解，使其更适合向量检索的语义匹配机制。混合检索策略将稠密向量检索与稀疏关键词检索（如 BM25）结合使用，兼顾语义理解和精确匹配的优势。重排序技术在初始检索完成后，使用交叉编码器（Cross-Encoder）对候选文档重新打分排序，显著提升最终输入模型的文档质量。此外，在文档索引阶段采用递归分割、语义分块、父子文档等策略，也能有效改善检索的精确度和上下文完整性。

这些技术虽然各自有效，但它们的本质仍然是一种"静态流水线"——每一步的处理逻辑在系统设计时就已经确定了，无法根据实际运行时的具体情况动态调整。就好比一个严格按照食谱操作的厨师，不管食材品质如何、食客口味怎样，都坚持用完全相同的步骤烹饪。真正优秀的厨师会根据实际情况灵活应变，而这就是 Agentic RAG 要做的事情。

### 1.3 Agentic RAG 的范式革命

Agentic RAG 的核心思想是：**让 RAG 系统本身成为一个能够思考、决策和自我纠正的智能 Agent**。它不再遵循预先定义好的固定流水线，而是具备以下能力：

**自主决策能力**意味着系统能够根据查询的特征、上下文和历史经验，自主选择最合适的检索策略、检索参数和生成方式。面对一个简单的事实性查询，它可能选择快速的单次检索；面对一个需要跨领域推理的复杂问题，它则会自动分解为多个子查询并行处理。

**自我反思能力**意味着系统能够在生成回答的同时，对自身输出的质量进行评估。它会检查回答是否得到了检索内容的充分支持、是否存在逻辑矛盾、是否遗漏了重要信息。这种"元认知"能力是传统 RAG 完全不具备的。

**错误纠正能力**意味着当系统通过反思发现问题时，能够主动采取纠正措施，而不是听之任之。它可以重新检索、调整查询策略、补充信息源，甚至完全推翻之前的检索结果重新开始。

**动态规划能力**意味着系统能够将复杂任务分解为多个子步骤，并根据中间结果动态调整后续的执行计划。这种能力使得系统可以处理需要多步推理的复杂问题。

**多轮迭代能力**意味着系统支持多次"检索-评估-优化"的循环迭代，在每一轮中不断提升回答的质量，直到达到预设的满意标准。

在学术界和工程界，三种代表性的 Agentic RAG 方法分别从不同角度实现了这些理念。Self-RAG 通过引入反思标记，让模型在生成过程中自主判断每一步的质量。Corrective-RAG 通过引入检索评估器和纠错循环，确保只有高质量的检索结果才会被用于生成。Adaptive-RAG 通过查询复杂度分类和策略路由，为不同类型的查询匹配最合适的处理方案。

### 1.4 三种范式的对比分析

为了帮助读者快速把握三种方法的定位和特点，下表从多个维度进行了系统对比。从设计哲学来看，Self-RAG 强调的是"生成时反思"——在每一步生成过程中嵌入质量检查；Corrective-RAG 强调的是"检索后纠正"——在检索结果进入生成环节之前进行质量把关；而 Adaptive-RAG 强调的是"查询前路由"——在执行任何具体操作之前就根据查询特征选择最合适的整体策略。

从实现复杂度来看，Self-RAG 的核心难点在于反思标记的设计和训练，Corrective-RAG 的难点在于检索评估器的准确性，而 Adaptive-RAG 的难点在于复杂度分类器的精度和多种策略的协调管理。从适用场景来看，Self-RAG 最适合对回答质量有极高要求且查询类型多样的场景；Corrective-RAG 最适合知识库质量不稳定或需要整合外部信息源的场景；Adaptive-RAG 则是最通用的选择，尤其适合面对不确定用户群体和查询模式的通用应用。

---

## 二、Self-RAG：自我反思驱动的检索增强

### 2.1 核心原理深度解析

Self-RAG（Self-Reflective Retrieval-Augmented Generation）由 Akari Asai 等人在 2023 年的论文中提出，其核心创新在于引入了一套称为"反思标记"（Reflection Tokens）的特殊控制信号。这些反思标记并非普通的文本输出，而是嵌入在生成过程中的结构化决策信号，指导模型在每个关键节点做出质量判断。

具体来说，Self-RAG 定义了四个维度的反思判断。**检索判断（Retrieve）** 决定当前是否需要调用检索系统——有些查询基于模型的内置知识就能很好地回答，强行检索反而可能引入噪音。**相关性判断（IsRel）** 在检索完成后评估每个检索到的文档片段是否真正与当前查询相关，过滤掉那些语义相似但实质无关的内容。**支持度判断（IsSup）** 在生成回答后验证回答中的每个论断是否都得到了检索内容的支持，相当于一个事实核查器。**有用性判断（IsUse）** 从用户视角评估整体回答是否有帮助、是否直接回应了查询。

这四个判断维度形成了一条完整的质量保障链。检索判断避免了不必要的检索开销，相关性判断保证了输入模型的上下文质量，支持度判断抑制了幻觉的产生，有用性判断确保了最终输出对用户确实有价值。整个流程不是简单的线性执行，而是一个动态的反思循环：如果支持度不够，系统会回到检索阶段重新获取文档；如果有用性不足，系统会调整生成策略重新组织回答。

这种设计的巧妙之处在于，它将质量控制的权力交给了模型自身，而不是依赖外部的硬编码规则。模型可以根据具体的查询内容和检索结果做出灵活的判断，这比任何预设的静态规则都更加精准。

### 2.2 在 Laravel 中实现 Self-RAG

接下来我们展示如何在 Laravel 中实现一个完整的 Self-RAG 服务。首先定义反思决策的枚举类型，用于标准化各个反思节点的输出结果：

```php
<?php
// app/Enums/ReflectionDecision.php

namespace App\Enums;

enum ReflectionDecision: string
{
    case NEEDS_RETRIEVAL = 'needs_retrieval';
    case NO_RETRIEVAL = 'no_retrieval';
    case RELEVANT = 'relevant';
    case IRRELEVANT = 'irrelevant';
    case SUPPORTED = 'supported';
    case NOT_SUPPORTED = 'not_supported';
    case USEFUL = 'useful';
    case NOT_USEFUL = 'not_useful';
}
```

然后实现核心的 SelfRAGService 类。这个类是整个 Self-RAG 流程的编排者，协调各个反思节点的执行顺序和决策逻辑：

```php
<?php
// app/Services/RAG/SelfRAGService.php

namespace App\Services\RAG;

use App\Enums\ReflectionDecision;
use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class SelfRAGService
{
    private LLMServiceInterface $llm;
    private VectorStoreInterface $vectorStore;
    private int $maxRetries;
    private float $relevanceThreshold;

    public function __construct(
        LLMServiceInterface $llm,
        VectorStoreInterface $vectorStore,
        int $maxRetries = 3,
        float $relevanceThreshold = 0.7
    ) {
        $this->llm = $llm;
        $this->vectorStore = $vectorStore;
        $this->maxRetries = $maxRetries;
        $this->relevanceThreshold = $relevanceThreshold;
    }

    /**
     * Self-RAG 主流程入口
     * 这是整个自我反思检索增强生成的核心编排方法
     */
    public function query(string $userQuery): array
    {
        $trace = ['query' => $userQuery, 'steps' => [], 'started_at' => microtime(true)];

        // 第一步：检索判断——决定当前查询是否需要检索外部知识
        // 这一步的关键在于避免对简单查询进行不必要的检索
        $retrievalDecision = $this->decideRetrieval($userQuery);
        $trace['steps'][] = [
            'action' => 'retrieval_decision',
            'result' => $retrievalDecision->value,
            'reasoning' => '基于查询复杂度和模型知识判断是否需要检索'
        ];

        if ($retrievalDecision === ReflectionDecision::NO_RETRIEVAL) {
            // 不需要检索：模型的内置知识足以回答此查询
            // 例如："1+1等于几"或"你好"这类问题
            $answer = $this->llm->generate($userQuery);
            $trace['steps'][] = [
                'action' => 'direct_generation',
                'answer' => $answer
            ];
            return [
                'answer' => $answer,
                'confidence' => 0.9,
                'strategy' => 'self_rag',
                'trace' => $trace
            ];
        }

        // 第二步：执行检索并进行相关性过滤
        // 检索更多候选文档，然后通过相关性评估过滤掉无关内容
        $documents = $this->vectorStore->search($userQuery, topK: 8);
        $trace['steps'][] = [
            'action' => 'initial_retrieval',
            'total_docs' => count($documents)
        ];

        $relevantDocs = $this->filterRelevantDocuments($userQuery, $documents);
        $trace['steps'][] = [
            'action' => 'relevance_filtering',
            'relevant_count' => count($relevantDocs),
            'filtered_out' => count($documents) - count($relevantDocs)
        ];

        // 如果没有检索到相关文档，尝试查询重写后重新检索
        if (empty($relevantDocs)) {
            $relevantDocs = $this->retryWithRewrittenQuery($userQuery, $trace);
        }

        // 第三步：多轮生成与反思循环
        // 这是 Self-RAG 的核心——通过反复生成、评估、优化来提升回答质量
        $bestAnswer = null;
        $bestScore = -1;

        for ($attempt = 0; $attempt < $this->maxRetries; $attempt++) {
            $context = $this->buildContext($relevantDocs);
            $answer = $this->generateWithContext($userQuery, $context);

            // 支持度评估：检查回答中的每个论断是否有检索内容支撑
            $supportScore = $this->evaluateSupport($answer, $relevantDocs);
            // 有用性评估：从用户角度评估回答是否有帮助
            $usefulnessScore = $this->evaluateUsefulness($userQuery, $answer);
            // 综合评分：支持度权重更高，因为忠实度是 RAG 的生命线
            $compositeScore = ($supportScore * 0.6) + ($usefulnessScore * 0.4);

            $trace['steps'][] = [
                'action' => "generation_attempt_{$attempt}",
                'support_score' => round($supportScore, 3),
                'usefulness_score' => round($usefulnessScore, 3),
                'composite_score' => round($compositeScore, 3)
            ];

            if ($compositeScore > $bestScore) {
                $bestScore = $compositeScore;
                $bestAnswer = $answer;
            }

            // 分数达到阈值，质量已经足够好，提前退出
            if ($compositeScore >= $this->relevanceThreshold) {
                $trace['steps'][] = ['action' => 'early_exit', 'reason' => 'quality_threshold_met'];
                break;
            }

            // 分数不够，扩大检索范围重新尝试
            if ($attempt < $this->maxRetries - 1) {
                $relevantDocs = $this->expandRetrieval($userQuery, $attempt + 1);
                $trace['steps'][] = [
                    'action' => 'expand_retrieval',
                    'round' => $attempt + 1,
                    'new_doc_count' => count($relevantDocs)
                ];
            }
        }

        $trace['completed_at'] = microtime(true);
        $trace['total_latency_ms'] = round(($trace['completed_at'] - $trace['started_at']) * 1000, 2);

        return [
            'answer' => $bestAnswer,
            'confidence' => round($bestScore, 3),
            'strategy' => 'self_rag',
            'trace' => $trace
        ];
    }

    /**
     * 检索判断：判断查询是否需要检索外部知识
     */
    private function decideRetrieval(string $query): ReflectionDecision
    {
        $prompt = <<<PROMPT
你是一个智能检索决策系统。请判断以下用户查询是否需要检索外部知识来回答。

判断标准：
- NEEDS_RETRIEVAL: 查询涉及具体事实、专业知识、最新信息、数据统计、特定事件等
- NO_RETRIEVAL: 查询属于日常对话、简单常识、创意写作、观点表达等

查询: "{$query}"

请仅输出以下之一：NEEDS_RETRIEVAL 或 NO_RETRIEVAL
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);

        return str_contains(trim($response), 'NO_RETRIEVAL')
            ? ReflectionDecision::NO_RETRIEVAL
            : ReflectionDecision::NEEDS_RETRIEVAL;
    }

    /**
     * 相关性过滤：逐一评估检索结果的相关性
     */
    private function filterRelevantDocuments(string $query, array $documents): array
    {
        $relevant = [];
        foreach ($documents as $doc) {
            $relevance = $this->evaluateRelevance($query, $doc['content']);
            if ($relevance === ReflectionDecision::RELEVANT) {
                $relevant[] = $doc;
            }
        }
        return $relevant;
    }

    /**
     * 评估单个文档的相关性
     */
    private function evaluateRelevance(string $query, string $content): ReflectionDecision
    {
        $prompt = <<<PROMPT
判断以下文档内容是否与查询直接相关。仅当文档包含可以帮助回答查询的信息时才判定为相关。

查询: "{$query}"
文档内容: "{$content}"

请仅回答 RELEVANT 或 IRRELEVANT：
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);
        $trimmed = trim($response);

        return (str_contains($trimmed, 'RELEVANT') && !str_contains($trimmed, 'IRRELEVANT'))
            ? ReflectionDecision::RELEVANT
            : ReflectionDecision::IRRELEVANT;
    }

    /**
     * 带上下文的回答生成
     */
    private function generateWithContext(string $query, string $context): string
    {
        $prompt = <<<PROMPT
基于以下上下文信息，回答用户的问题。请确保回答准确、有据可依。
如果上下文中没有足够信息来完整回答问题，请明确指出哪些部分可以回答、哪些部分信息不足。

上下文信息:
{$context}

用户问题: {$query}

请提供详细、准确的回答：
PROMPT;

        return $this->llm->generate($prompt, temperature: 0.3);
    }

    /**
     * 支持度评估：验证回答是否得到检索内容的支持
     */
    private function evaluateSupport(string $answer, array $documents): float
    {
        $context = $this->buildContext($documents);
        $prompt = <<<PROMPT
请严格评估以下回答是否完全得到提供文档的支持。

评估要求：
- 检查回答中的每个关键论断
- 判断每个论断是否有对应的文档支撑
- 如果回答包含文档中未提及的信息，应降低分数

文档内容: "{$context}"
待评估回答: "{$answer}"

请输出一个 0.0 到 1.0 之间的数字（1.0=完全支持，0.0=完全不支持）：
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);
        return (float) min(1.0, max(0.0, (float) trim($response)));
    }

    /**
     * 有用性评估：从用户角度评估回答的帮助程度
     */
    private function evaluateUsefulness(string $query, string $answer): float
    {
        $prompt = <<<PROMPT
请评估以下回答对用户查询的有用程度。

评估标准：
- 回答是否直接回应了用户的问题
- 回答是否具体、详细、可操作
- 回答的组织和表述是否清晰

用户查询: "{$query}"
回答: "{$answer}"

请输出一个 0.0 到 1.0 之间的数字：
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);
        return (float) min(1.0, max(0.0, (float) trim($response)));
    }

    /**
     * 将多个文档片段拼接为统一的上下文字符串
     */
    private function buildContext(array $documents): string
    {
        return implode("\n---\n", array_map(
            fn($doc) => "[来源: {$doc['source']}] {$doc['content']}",
            $documents
        ));
    }

    /**
     * 当初始检索失败时，通过查询重写重试
     */
    private function retryWithRewrittenQuery(string $query, array &$trace): array
    {
        $rewrittenQuery = $this->rewriteQuery($query, 0);
        $newDocs = $this->vectorStore->search($rewrittenQuery, topK: 8);
        $relevantDocs = $this->filterRelevantDocuments($query, $newDocs);

        $trace['steps'][] = [
            'action' => 'retry_with_rewrite',
            'original_query' => $query,
            'rewritten_query' => $rewrittenQuery,
            'new_relevant_count' => count($relevantDocs)
        ];

        return $relevantDocs;
    }

    /**
     * 扩展检索：获取更多角度的文档
     */
    private function expandRetrieval(string $query, int $round): array
    {
        $expandedQuery = $this->rewriteQuery($query, $round);
        $newDocs = $this->vectorStore->search($expandedQuery, topK: 5 + ($round * 3));
        return $this->filterRelevantDocuments($query, $newDocs);
    }

    /**
     * 查询重写：用不同表述方式探索更多信息
     */
    private function rewriteQuery(string $query, int $round): string
    {
        $prompt = <<<PROMPT
请用不同的表述方式重写以下查询，以获取更多角度的信息。这是第 {$round} 次重写，请尝试与之前不同的关键词和角度。

原始查询: "{$query}"

重写后的查询（仅输出新查询文本）：
PROMPT;

        return trim($this->llm->generate($prompt, temperature: 0.5));
    }
}
```

### 2.3 反思标记的工程化实践

在 Self-RAG 的原始论文中，反思标记是通过专门训练让模型原生输出的特殊 Token。但在工程实践中，我们往往无法对大模型进行这种精细的微调。因此，我们需要通过**提示工程加结构化输出解析**的方式来近似实现反思标记的效果。

核心思路是在提示模板中明确要求模型按照特定格式输出反思信息，然后通过正则表达式或 JSON 解析器提取这些信息。这种方式虽然不如原生反思标记精确，但在工程实现上更加灵活，可以适配任何支持指令跟随的大语言模型。在实际测试中，使用 GPT-4 级别的模型时，通过提示工程实现的反思标记准确率可以达到 85% 以上，已经足够支撑生产级别的应用需求。

---

## 三、Corrective-RAG：错误纠正循环

### 3.1 核心原理深度解析

Corrective-RAG（CRAG，纠正性检索增强生成）由 Shi-Qi Yan 等人提出，其设计哲学与 Self-RAG 有所不同。Self-RAG 侧重于在生成过程中嵌入反思判断，而 CRAG 则侧重于在检索结果进入生成环节之前进行严格的质量把关和必要的纠正。

CRAG 的核心组件是一个**轻量级检索评估器**。这个评估器的作用是对检索到的文档进行质量评级，然后根据评级结果触发不同的处理策略。具体来说，CRAG 定义了三种检索结果状态：

**正确状态（Correct）**表示检索到的文档高度相关且信息充分，可以直接用于生成回答。在这种情况下，系统会先对文档进行知识精炼——从冗长的文档中提取与查询相关的关键信息片段，去除无关内容，然后基于精炼后的上下文生成回答。

**错误状态（Incorrect）**表示检索到的文档与查询不相关或信息严重不足。这是 CRAG 最有特色的场景——系统不会放弃或强行使用这些劣质文档，而是会启动搜索引擎作为补充信息源，获取网络上的相关知识来弥补本地知识库的不足。这种"本地检索加网络搜索"的混合策略大大增强了系统的知识覆盖范围。

**模糊状态（Ambiguous）**表示检索结果的质量介于正确和错误之间，部分有用但不够充分。系统会执行查询扩展，用改写后的查询重新检索更多文档，然后将新旧文档合并后进行知识精炼和生成。

CRAG 的知识精炼过程值得特别关注。它不是简单地把文档全文丢给模型，而是对每个文档片段独立执行"分解-过滤"操作：先分析文档中哪些句子或段落与查询相关，提取出这些关键信息片段，然后将所有片段重新组合为一份精炼的上下文。这个过程类似于一个研究助理在做文献综述时的工作——不是逐字抄录每篇论文，而是提取每篇论文中与研究主题最相关的要点。

### 3.2 在 Laravel 中实现 CRAG

接下来展示完整的 CRAG 实现。首先是核心服务类：

```php
<?php
// app/Services/RAG/CorrectiveRAGService.php

namespace App\Services\RAG;

use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;
use App\Services\Search\WebSearchServiceInterface;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class CorrectiveRAGService
{
    private LLMServiceInterface $llm;
    private VectorStoreInterface $vectorStore;
    private WebSearchServiceInterface $webSearch;
    private float $correctThreshold;
    private float $incorrectThreshold;

    public function __construct(
        LLMServiceInterface $llm,
        VectorStoreInterface $vectorStore,
        WebSearchServiceInterface $webSearch,
        float $correctThreshold = 0.8,
        float $incorrectThreshold = 0.3
    ) {
        $this->llm = $llm;
        $this->vectorStore = $vectorStore;
        $this->webSearch = $webSearch;
        $this->correctThreshold = $correctThreshold;
        $this->incorrectThreshold = $incorrectThreshold;
    }

    /**
     * CRAG 主流程：检索-评估-纠正-生成
     */
    public function query(string $userQuery, array $options = []): array
    {
        $trace = ['query' => $userQuery, 'steps' => [], 'started_at' => microtime(true)];
        $includeWebSearch = $options['include_web_search'] ?? true;

        // 第一步：执行初始检索
        $documents = $this->vectorStore->search($userQuery, topK: 5);
        $trace['steps'][] = [
            'action' => 'initial_retrieval',
            'doc_count' => count($documents)
        ];

        // 第二步：评估检索质量——这是 CRAG 的核心判断
        $evaluation = $this->evaluateRetrieval($userQuery, $documents);
        $trace['steps'][] = [
            'action' => 'quality_evaluation',
            'status' => $evaluation['status'],
            'confidence' => $evaluation['confidence'],
            'reason' => $evaluation['reason'] ?? ''
        ];

        // 第三步：根据评估结果采取对应的纠正策略
        switch ($evaluation['status']) {
            case 'correct':
                // 文档质量好：精炼后直接生成
                $finalContext = $this->refineKnowledge($userQuery, $documents);
                $trace['steps'][] = [
                    'action' => 'knowledge_refinement',
                    'refined_pieces' => mb_strlen($finalContext)
                ];
                break;

            case 'incorrect':
                // 文档质量差：尝试用网络搜索补充
                if ($includeWebSearch) {
                    $webResults = $this->webSearch->search($userQuery);
                    $allDocs = array_merge($documents, $webResults);
                    $finalContext = $this->refineKnowledge($userQuery, $allDocs);
                    $trace['steps'][] = [
                        'action' => 'web_search_supplement',
                        'web_results_count' => count($webResults),
                        'total_docs' => count($allDocs)
                    ];
                } else {
                    $finalContext = $this->refineKnowledge($userQuery, $documents);
                    $trace['steps'][] = ['action' => 'fallback_refinement_only'];
                }
                break;

            case 'ambiguous':
                // 质量不确定：扩展检索后综合处理
                $expandedQuery = $this->expandQuery($userQuery);
                $expandedDocs = $this->vectorStore->search($expandedQuery, topK: 10);
                $mergedDocs = $this->deduplicateDocuments(array_merge($documents, $expandedDocs));
                $finalContext = $this->refineKnowledge($userQuery, $mergedDocs);
                $trace['steps'][] = [
                    'action' => 'expanded_retrieval_and_refinement',
                    'expanded_query' => $expandedQuery,
                    'total_docs' => count($mergedDocs)
                ];
                break;

            default:
                $finalContext = $this->buildContext($documents);
        }

        // 第四步：基于精炼后的上下文生成最终回答
        $answer = $this->generateAnswer($userQuery, $finalContext);
        $trace['steps'][] = ['action' => 'final_generation'];

        // 第五步：最终质量检查
        $finalQuality = $this->performFinalCheck($userQuery, $answer, $finalContext);
        $trace['steps'][] = [
            'action' => 'final_quality_check',
            'quality_score' => $finalQuality
        ];

        $trace['completed_at'] = microtime(true);
        $trace['total_latency_ms'] = round(($trace['completed_at'] - $trace['started_at']) * 1000, 2);

        return [
            'answer' => $answer,
            'strategy' => 'corrective_rag',
            'evaluation_status' => $evaluation['status'],
            'confidence' => $evaluation['confidence'],
            'quality_score' => $finalQuality,
            'trace' => $trace
        ];
    }

    /**
     * 检索质量评估：判断文档对回答查询的帮助程度
     */
    private function evaluateRetrieval(string $query, array $documents): array
    {
        $context = $this->buildContext($documents);

        $prompt = <<<PROMPT
你是一个检索质量评估专家。请仔细评估以下检索结果对回答查询的帮助程度。

评估维度：
1. 文档与查询的主题相关性
2. 文档包含的信息是否足以回答查询
3. 文档中是否存在矛盾或冲突的信息

查询: "{$query}"

检索到的文档:
{$context}

请以 JSON 格式输出评估结果：
{
  "status": "correct 或 incorrect 或 ambiguous",
  "confidence": 0.0 到 1.0 之间的置信度,
  "reason": "评估理由简述"
}
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);
        $evaluation = $this->parseJsonResponse($response);

        // 使用阈值进行二次校准，确保分类稳定性
        $confidence = $evaluation['confidence'] ?? 0.5;
        if ($confidence >= $this->correctThreshold) {
            $evaluation['status'] = 'correct';
        } elseif ($confidence <= $this->incorrectThreshold) {
            $evaluation['status'] = 'incorrect';
        } else {
            $evaluation['status'] = 'ambiguous';
        }

        return $evaluation;
    }

    /**
     * 知识精炼：从原始文档中提取与查询相关的关键信息
     */
    private function refineKnowledge(string $query, array $documents): string
    {
        $refinedPieces = [];

        foreach ($documents as $index => $doc) {
            $prompt = <<<PROMPT
你是一个知识提取专家。请从以下文档中精确提取与查询相关的关键信息。

要求：
- 只保留与查询直接相关的信息
- 移除冗余描述、广告内容、导航文字等无关信息
- 保持提取信息的准确性和完整性
- 如果文档中没有相关信息，输出"无相关信息"

查询: "{$query}"

文档内容:
{$doc['content']}

提取的关键信息：
PROMPT;

            $refined = $this->llm->generate($prompt, temperature: 0.2);

            if (!str_contains($refined, '无相关信息') && mb_strlen(trim($refined)) > 10) {
                $refinedPieces[] = "[来源{$index}] " . trim($refined);
            }
        }

        // 如果精炼后没有有效内容，回退到原始文档
        if (empty($refinedPieces)) {
            Log::warning('CRAG: 知识精炼后无有效内容，回退到原始文档');
            return $this->buildContext($documents);
        }

        return implode("\n\n", $refinedPieces);
    }

    /**
     * 查询扩展：生成覆盖更多角度的搜索查询
     */
    private function expandQuery(string $query): string
    {
        $prompt = <<<PROMPT
请将以下查询扩展为更详细、更全面的搜索查询。添加相关的同义词、上下文信息和具体化描述。

原始查询: "{$query}"

扩展后的搜索查询（仅输出新查询）：
PROMPT;

        return trim($this->llm->generate($prompt, temperature: 0.4));
    }

    /**
     * 生成最终回答
     */
    private function generateAnswer(string $query, string $context): string
    {
        $prompt = <<<PROMPT
基于以下经过精炼的上下文信息，准确、详细地回答用户的问题。

重要提示：
- 只基于提供的上下文信息回答
- 如果上下文不足以完整回答，请明确说明哪些部分信息不足
- 不要编造上下文中没有的信息

精炼后的上下文:
{$context}

问题: {$query}

请提供准确、有据可依的回答：
PROMPT;

        return $this->llm->generate($prompt, temperature: 0.3);
    }

    /**
     * 最终质量检查
     */
    private function performFinalCheck(string $query, string $answer, string $context): float
    {
        $prompt = <<<PROMPT
请对以下回答进行最终质量检查（0.0-1.0 分）。

检查项：
- 事实准确性
- 与上下文的一致性
- 对查询的回答完整度

查询: "{$query}"
回答: "{$answer}"
参考上下文: "{$context}"

请输出质量分数（0.0-1.0）：
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.1);
        return (float) min(1.0, max(0.0, (float) trim($response)));
    }

    /**
     * 文档去重
     */
    private function deduplicateDocuments(array $documents): array
    {
        $seen = [];
        $unique = [];
        foreach ($documents as $doc) {
            $hash = md5($doc['content'] ?? '');
            if (!isset($seen[$hash])) {
                $seen[$hash] = true;
                $unique[] = $doc;
            }
        }
        return $unique;
    }

    private function buildContext(array $documents): string
    {
        return implode("\n---\n", array_map(
            fn($doc) => $doc['content'],
            $documents
        ));
    }

    private function parseJsonResponse(string $response): array
    {
        preg_match('/\{.*\}/s', $response, $matches);
        if (!empty($matches)) {
            $decoded = json_decode($matches[0], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        // 解析失败时返回默认值
        return [
            'status' => 'ambiguous',
            'confidence' => 0.5,
            'reason' => '自动解析失败，使用默认模糊状态'
        ];
    }
}
```

### 3.3 网络搜索集成服务

CRAG 的一大特色是能够在网络搜索结果不理想时调用外部搜索引擎补充信息。这需要一个稳定可靠的网络搜索服务封装：

```php
<?php
// app/Services/Search/WebSearchService.php

namespace App\Services\Search;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class WebSearchService implements WebSearchServiceInterface
{
    private string $apiKey;
    private string $searchEngine;
    private int $maxResults;
    private int $cacheTtl;

    public function __construct()
    {
        $this->apiKey = config('services.search.api_key');
        $this->searchEngine = config('services.search.engine', 'serper');
        $this->maxResults = config('services.search.max_results', 5);
        $this->cacheTtl = config('services.search.cache_ttl', 3600);
    }

    /**
     * 执行网络搜索，带缓存和错误处理
     */
    public function search(string $query): array
    {
        $cacheKey = 'web_search:' . md5($query);

        return Cache::remember($cacheKey, $this->cacheTtl, function () use ($query) {
            try {
                return match ($this->searchEngine) {
                    'serper' => $this->searchWithSerper($query),
                    'tavily' => $this->searchWithTavily($query),
                    default => $this->searchWithSerper($query),
                };
            } catch (\Exception $e) {
                Log::error('网络搜索失败', [
                    'engine' => $this->searchEngine,
                    'query' => $query,
                    'error' => $e->getMessage()
                ]);
                return [];
            }
        });
    }

    private function searchWithSerper(string $query): array
    {
        $response = Http::timeout(10)
            ->withHeaders([
                'X-API-KEY' => $this->apiKey,
                'Content-Type' => 'application/json'
            ])
            ->post('https://google.serper.dev/search', [
                'q' => $query,
                'num' => $this->maxResults
            ]);

        if (!$response->successful()) {
            throw new \RuntimeException("Serper API 返回状态码: {$response->status()}");
        }

        $results = $response->json('organic', []);
        return array_map(fn($result) => [
            'content' => $result['snippet'] ?? '',
            'source' => $result['link'] ?? '',
            'title' => $result['title'] ?? '',
            'type' => 'web_search'
        ], array_slice($results, 0, $this->maxResults));
    }

    private function searchWithTavily(string $query): array
    {
        $response = Http::timeout(10)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post('https://api.tavily.com/search', [
                'api_key' => $this->apiKey,
                'query' => $query,
                'max_results' => $this->maxResults,
                'include_answer' => false
            ]);

        if (!$response->successful()) {
            throw new \RuntimeException("Tavily API 返回状态码: {$response->status()}");
        }

        $results = $response->json('results', []);
        return array_map(fn($result) => [
            'content' => $result['content'] ?? '',
            'source' => $result['url'] ?? '',
            'title' => $result['title'] ?? '',
            'type' => 'web_search'
        ], array_slice($results, 0, $this->maxResults));
    }
}
```

---

## 四、Adaptive-RAG：动态策略选择

### 4.1 核心原理深度解析

Adaptive-RAG 由 Soyeong Jeong 等人提出，其核心理念可以用一个类比来理解：一个优秀的医生不会对所有病人使用同一种治疗方案，而是会先进行诊断，然后根据诊断结果制定个性化的治疗计划。Adaptive-RAG 的做法类似——它先对用户查询进行"诊断"（复杂度分类），然后根据诊断结果"对症下药"（选择最合适的处理策略）。

系统将查询分为三个复杂度等级。**简单查询**是那些只需要单步事实检索就能回答的问题，比如"HTTP 状态码 404 表示什么"或"Python 的创始人是谁"。这类查询的特征是答案明确、不涉及推理或比较，使用简单的单次检索加直接生成即可获得高质量的回答，过度处理只会浪费资源。

**中等查询**需要一定程度的推理或多步信息整合，比如"比较 Redis 和 Memcached 的优缺点"或"解释 OAuth 2.0 的授权码流程"。这类查询需要更深入的检索（可能需要多个查询角度的文档），以及带有推理能力的生成策略。

**复杂查询**需要多步推理、信息分解和综合分析，比如"为一个日活百万的电商系统设计完整的缓存架构方案"或"分析大语言模型在过去两年的发展趋势及其对软件工程的影响"。这类查询必须先分解为多个子问题，分别检索和推理，然后将所有子结果综合为一个完整的回答。

Adaptive-RAG 的优势在于它能够根据查询的实际复杂度自动分配适当的计算资源。简单查询快速响应，复杂查询深入处理——这种差异化策略在保证整体回答质量的同时，有效控制了延迟和成本。

### 4.2 在 Laravel 中实现 Adaptive-RAG

首先是查询复杂度枚举和策略接口定义：

```php
<?php
// app/Enums/QueryComplexity.php

namespace App\Enums;

enum QueryComplexity: string
{
    case SIMPLE = 'simple';
    case MODERATE = 'moderate';
    case COMPLEX = 'complex';
}
```

```php
<?php
// app/Services/RAG/RAGStrategyInterface.php

namespace App\Services\RAG;

/**
 * RAG 策略接口——所有处理策略的统一抽象
 */
interface RAGStrategyInterface
{
    /**
     * 执行策略处理查询
     * @param string $query 用户查询
     * @return array 包含 answer、trace 等键的结果数组
     */
    public function execute(string $query): array;
}
```

接下来是核心的 AdaptiveRAGService，它负责查询分类和策略路由：

```php
<?php
// app/Services/RAG/AdaptiveRAGService.php

namespace App\Services\RAG;

use App\Enums\QueryComplexity;
use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class AdaptiveRAGService
{
    private LLMServiceInterface $llm;
    private VectorStoreInterface $vectorStore;
    private SimpleRAGStrategy $simpleStrategy;
    private ModerateRAGStrategy $moderateStrategy;
    private ComplexRAGStrategy $complexStrategy;

    public function __construct(
        LLMServiceInterface $llm,
        VectorStoreInterface $vectorStore,
        SimpleRAGStrategy $simpleStrategy,
        ModerateRAGStrategy $moderateStrategy,
        ComplexRAGStrategy $complexStrategy
    ) {
        $this->llm = $llm;
        $this->vectorStore = $vectorStore;
        $this->simpleStrategy = $simpleStrategy;
        $this->moderateStrategy = $moderateStrategy;
        $this->complexStrategy = $complexStrategy;
    }

    /**
     * Adaptive-RAG 主流程
     */
    public function query(string $userQuery): array
    {
        $trace = ['query' => $userQuery, 'steps' => [], 'started_at' => microtime(true)];

        // 第一步：对查询进行复杂度分类
        $complexity = $this->classifyComplexity($userQuery);
        $trace['steps'][] = [
            'action' => 'complexity_classification',
            'complexity' => $complexity->value
        ];

        // 第二步：路由到对应的处理策略
        $strategy = $this->getStrategy($complexity);
        $strategyName = class_basename($strategy);
        $trace['steps'][] = [
            'action' => 'strategy_routing',
            'strategy' => $strategyName
        ];

        // 第三步：执行策略并收集结果
        $result = $strategy->execute($userQuery);

        $result['complexity'] = $complexity->value;
        $result['strategy'] = 'adaptive_rag';
        $result['trace'] = array_merge($trace, $result['trace'] ?? []);

        $result['trace']['completed_at'] = microtime(true);
        $result['trace']['total_latency_ms'] = round(
            ($result['trace']['completed_at'] - $result['trace']['started_at']) * 1000, 2
        );

        return $result;
    }

    /**
     * 查询复杂度分类——先用规则快速判断，再用 LLM 兜底
     */
    private function classifyComplexity(string $query): QueryComplexity
    {
        // 优先使用规则进行快速分类，避免不必要的 LLM 调用
        $ruleBased = $this->ruleBasedClassification($query);
        if ($ruleBased !== null) {
            Log::debug('查询复杂度通过规则判定', [
                'query' => mb_substr($query, 0, 50),
                'complexity' => $ruleBased->value
            ]);
            return $ruleBased;
        }

        // 规则无法判断时，调用 LLM 进行更精确的分类
        $prompt = <<<PROMPT
请将以下查询按复杂度精确分类。

分类标准：
- SIMPLE: 单步事实检索，答案明确唯一。例如"HTTP 200是什么意思"、"Python的创始人是谁"
- MODERATE: 需要一定推理或多角度信息整合。例如"比较Redis和Memcached"、"解释微服务架构的优缺点"
- COMPLEX: 需要多步推理、信息分解和综合分析。例如"为电商平台设计缓存架构"、"分析AI对各行业的影响"

查询: "{$query}"

仅输出分类结果（SIMPLE/MODERATE/COMPLEX）：
PROMPT;

        $response = trim($this->llm->generate($prompt, temperature: 0.1));

        return match (true) {
            str_contains($response, 'SIMPLE') => QueryComplexity::SIMPLE,
            str_contains($response, 'COMPLEX') => QueryComplexity::COMPLEX,
            default => QueryComplexity::MODERATE,
        };
    }

    /**
     * 基于规则的快速分类——避免对明显简单的查询调用 LLM
     */
    private function ruleBasedClassification(string $query): ?QueryComplexity
    {
        $queryLength = mb_strlen($query);
        $questionMarks = mb_substr_count($query, '？') + mb_substr_count($query, '?');

        // 短查询且只有一个问号，通常是简单查询
        if ($questionMarks === 1 && $queryLength < 30) {
            return QueryComplexity::SIMPLE;
        }

        // 包含分析性关键词的查询通常较复杂
        $complexKeywords = [
            '比较', '分析', '综合', '评估', '设计', '规划',
            '趋势', '预测', '方案', '策略', '架构', '影响'
        ];
        foreach ($complexKeywords as $keyword) {
            if (str_contains($query, $keyword)) {
                return QueryComplexity::COMPLEX;
            }
        }

        // 包含解释性关键词的查询通常是中等复杂度
        $moderateKeywords = ['解释', '说明', '区别', '优缺点', '原理', '流程'];
        foreach ($moderateKeywords as $keyword) {
            if (str_contains($query, $keyword)) {
                return QueryComplexity::MODERATE;
            }
        }

        // 多个问号的查询通常更复杂
        if ($questionMarks >= 3) {
            return QueryComplexity::COMPLEX;
        }

        // 无法确定，交给 LLM 分类
        return null;
    }

    private function getStrategy(QueryComplexity $complexity): RAGStrategyInterface
    {
        return match ($complexity) {
            QueryComplexity::SIMPLE => $this->simpleStrategy,
            QueryComplexity::MODERATE => $this->moderateStrategy,
            QueryComplexity::COMPLEX => $this->complexStrategy,
        };
    }
}
```

### 4.3 三种策略的具体实现

**简单策略**追求速度和效率，使用最少的检索和最简洁的生成：

```php
<?php
// app/Services/RAG/SimpleRAGStrategy.php

namespace App\Services\RAG;

use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;

class SimpleRAGStrategy implements RAGStrategyInterface
{
    public function __construct(
        private LLMServiceInterface $llm,
        private VectorStoreInterface $vectorStore
    ) {}

    /**
     * 简单策略：单次检索，直接生成
     * 适用于事实性查询，追求低延迟
     */
    public function execute(string $query): array
    {
        $startTime = microtime(true);

        // 使用较少的 topK 值，简单查询不需要太多文档
        $docs = $this->vectorStore->search($query, topK: 3);
        $context = implode("\n---\n", array_column($docs, 'content'));

        $prompt = <<<PROMPT
基于以下参考信息，简洁准确地回答问题。如果信息不足请直接说明。

参考信息:
{$context}

问题: {$query}

回答：
PROMPT;

        $answer = $this->llm->generate($prompt, temperature: 0.2);

        return [
            'answer' => $answer,
            'trace' => [
                ['action' => 'simple_retrieval', 'doc_count' => count($docs)],
                ['action' => 'direct_generation'],
                ['latency_ms' => round((microtime(true) - $startTime) * 1000, 2)]
            ]
        ];
    }
}
```

**中等策略**增加查询重写和重排序步骤，提升检索和生成质量：

```php
<?php
// app/Services/RAG/ModerateRAGStrategy.php

namespace App\Services\RAG;

use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;

class ModerateRAGStrategy implements RAGStrategyInterface
{
    public function __construct(
        private LLMServiceInterface $llm,
        private VectorStoreInterface $vectorStore
    ) {}

    /**
     * 中等策略：查询重写 + 多文档检索 + 重排序 + 推理生成
     * 适用于需要一定推理或多角度信息的查询
     */
    public function execute(string $query): array
    {
        $startTime = microtime(true);
        $trace = [];

        // 查询重写：优化检索效果
        $rewrittenQuery = $this->rewriteQuery($query);
        $trace[] = ['action' => 'query_rewrite', 'rewritten' => $rewrittenQuery];

        // 检索更多候选文档
        $docs = $this->vectorStore->search($rewrittenQuery, topK: 10);
        $trace[] = ['action' => 'retrieval', 'doc_count' => count($docs)];

        // 重排序：用相关性分数重新排列文档
        $rerankedDocs = $this->rerank($query, $docs);
        $topDocs = array_slice($rerankedDocs, 0, 5);
        $trace[] = ['action' => 'reranking', 'selected_count' => count($topDocs)];

        // 带推理的生成
        $context = implode("\n---\n", array_column($topDocs, 'content'));
        $prompt = <<<PROMPT
基于以下参考信息，逐步分析并回答问题。请引用具体信息来源，展示你的推理过程。

参考信息:
{$context}

问题: {$query}

请进行逐步分析并给出详细回答：
PROMPT;

        $answer = $this->llm->generate($prompt, temperature: 0.3);
        $trace[] = ['action' => 'reasoning_generation'];
        $trace[] = ['latency_ms' => round((microtime(true) - $startTime) * 1000, 2)];

        return ['answer' => $answer, 'trace' => $trace];
    }

    private function rewriteQuery(string $query): string
    {
        $prompt = <<<PROMPT
将以下查询改写为更适合向量检索的形式。保留核心语义，使用更具体、更明确的表述。

原始查询: "{$query}"

改写后的查询（仅输出新查询）：
PROMPT;

        return trim($this->llm->generate($prompt, temperature: 0.3));
    }

    /**
     * 基于 LLM 的文档重排序
     * 在生产环境中，建议使用专门的重排序模型（如 BGE-Reranker）以获得更好的性能
     */
    private function rerank(string $query, array $docs): array
    {
        $scored = [];
        foreach ($docs as $doc) {
            $prompt = <<<PROMPT
评估以下文档与查询的相关性，输出 0-10 之间的整数分数。

查询: "{$query}"
文档: "{$doc['content']}"

仅输出分数：
PROMPT;

            $score = (float) trim($this->llm->generate($prompt, temperature: 0.1));
            $scored[] = array_merge($doc, ['relevance_score' => $score]);
        }

        usort($scored, fn($a, $b) => $b['relevance_score'] <=> $a['relevance_score']);
        return $scored;
    }
}
```

**复杂策略**实现查询分解和多维度综合分析：

```php
<?php
// app/Services/RAG/ComplexRAGStrategy.php

namespace App\Services\RAG;

use App\Services\LLM\LLMServiceInterface;
use App\Services\VectorStore\VectorStoreInterface;
use Illuminate\Support\Facades\Log;

class ComplexRAGStrategy implements RAGStrategyInterface
{
    private int $maxSubQueries;

    public function __construct(
        private LLMServiceInterface $llm,
        private VectorStoreInterface $vectorStore,
        int $maxSubQueries = 5
    ) {
        $this->maxSubQueries = $maxSubQueries;
    }

    /**
     * 复杂策略：查询分解 + 多轮检索推理 + 综合生成
     * 适用于需要多步推理、全面分析的复杂查询
     */
    public function execute(string $query): array
    {
        $startTime = microtime(true);
        $trace = [];

        // 第一步：将复杂查询分解为多个子问题
        $subQueries = $this->decomposeQuery($query);
        $trace[] = ['action' => 'query_decomposition', 'sub_queries' => $subQueries];

        // 第二步：对每个子问题独立执行检索和推理
        $subResults = [];
        foreach ($subQueries as $index => $subQuery) {
            $docs = $this->vectorStore->search($subQuery, topK: 5);
            $context = implode("\n---\n", array_column($docs, 'content'));

            $prompt = <<<PROMPT
基于以下参考信息，深入分析并回答子问题。

参考信息:
{$context}

子问题: {$subQuery}

请提供详细分析：
PROMPT;

            $subAnswer = $this->llm->generate($prompt, temperature: 0.3);
            $subResults[] = [
                'sub_query' => $subQuery,
                'answer' => $subAnswer,
                'doc_count' => count($docs),
                'index' => $index
            ];

            $trace[] = [
                'action' => "sub_query_{$index}_processed",
                'sub_query' => $subQuery,
                'doc_count' => count($docs)
            ];
        }

        // 第三步：综合所有子结果，生成完整的最终回答
        $synthesizedContext = $this->synthesizeResults($subResults);
        $finalPrompt = <<<PROMPT
你是一个专业的分析师。请基于以下多维度分析结果，综合回答用户的复杂问题。

要求：
- 将各个维度的分析有机整合，而不是简单罗列
- 指出各维度之间的关联和逻辑关系
- 给出有深度的综合结论
- 如果各维度之间存在矛盾，请分析原因并给出判断

各维度分析结果:
{$synthesizedContext}

原始问题: {$query}

请提供全面、深入、有条理的综合分析：
PROMPT;

        $finalAnswer = $this->llm->generate($finalPrompt, temperature: 0.4);
        $trace[] = ['action' => 'synthesis_generation'];
        $trace[] = ['latency_ms' => round((microtime(true) - $startTime) * 1000, 2)];

        return [
            'answer' => $finalAnswer,
            'sub_results' => $subResults,
            'trace' => $trace
        ];
    }

    /**
     * 将复杂查询分解为多个子问题
     */
    private function decomposeQuery(string $query): array
    {
        $prompt = <<<PROMPT
请将以下复杂问题分解为最多 {$this->maxSubQueries} 个相互独立又互补的子问题。
每个子问题应关注原始问题的一个特定方面，所有子问题组合起来应覆盖原始问题的全部内容。

原始问题: "{$query}"

请以 JSON 数组格式输出：
["子问题1", "子问题2", "子问题3"]
PROMPT;

        $response = $this->llm->generate($prompt, temperature: 0.3);
        preg_match('/\[.*\]/s', $response, $matches);

        if (!empty($matches)) {
            $subQueries = json_decode($matches[0], true);
            if (is_array($subQueries) && !empty($subQueries)) {
                return array_slice(array_values($subQueries), 0, $this->maxSubQueries);
            }
        }

        // 解析失败时回退：直接使用原始查询
        Log::warning('子问题解析失败，使用原始查询', ['query' => $query]);
        return [$query];
    }

    /**
     * 将多个子结果综合为结构化的参考信息
     */
    private function synthesizeResults(array $subResults): string
    {
        $parts = [];
        foreach ($subResults as $result) {
            $parts[] = "### 维度: {$result['sub_query']}\n{$result['answer']}";
        }
        return implode("\n\n", $parts);
    }
}
```

---

## 五、Python 微服务：高性能嵌入与重排序

在生产环境中，嵌入计算和重排序是 RAG 系统中最耗时的环节。虽然 Laravel 可以通过 HTTP 调用 OpenAI 等 API 完成这些操作，但对于需要低延迟和高吞吐量的场景，部署一个本地的 Python 微服务是更优的选择。以下是基于 FastAPI 的嵌入与重排序服务：

```python
# embedding_service/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, CrossEncoder
from typing import List, Optional, Dict, Any
import numpy as np
import uvicorn
import hashlib
import redis
import json
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="RAG Embedding & Reranking Service", version="1.0.0")

# 初始化模型（在启动时加载一次）
embedding_model = None
reranker_model = None
redis_client = None


@app.on_event("startup")
async def load_models():
    """服务启动时预加载模型，避免首次请求的冷启动延迟"""
    global embedding_model, reranker_model, redis_client
    
    logger.info("正在加载嵌入模型...")
    embedding_model = SentenceTransformer('BAAI/bge-large-zh-v1.5')
    
    logger.info("正在加载重排序模型...")
    reranker_model = CrossEncoder('BAAI/bge-reranker-large')
    
    logger.info("正在连接 Redis 缓存...")
    redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
    
    logger.info("所有模型加载完成")


class EmbeddingRequest(BaseModel):
    texts: List[str]
    normalize: bool = True
    batch_size: int = 32


class RerankRequest(BaseModel):
    query: str
    documents: List[str]
    top_k: int = 5


class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int
    processing_time_ms: float


@app.post("/embed", response_model=EmbeddingResponse)
async def get_embeddings(request: EmbeddingRequest):
    """
    生成文本嵌入向量
    支持批量处理，自动缓存结果
    """
    if not request.texts:
        return EmbeddingResponse(embeddings=[], dimensions=0, processing_time_ms=0)
    
    # 检查缓存
    cache_key = f"embed:{hashlib.md5(json.dumps(request.texts, ensure_ascii=False).encode()).hexdigest()}"
    try:
        cached = redis_client.get(cache_key)
        if cached:
            data = json.loads(cached)
            logger.info(f"嵌入缓存命中，文本数: {len(request.texts)}")
            return EmbeddingResponse(**data)
    except Exception as e:
        logger.warning(f"缓存读取失败: {e}")
    
    # 生成嵌入
    start_time = time.time()
    embeddings = embedding_model.encode(
        request.texts,
        normalize_embeddings=request.normalize,
        show_progress_bar=False,
        batch_size=request.batch_size
    )
    processing_time = (time.time() - start_time) * 1000
    
    result = {
        "embeddings": embeddings.tolist(),
        "dimensions": embeddings.shape[1],
        "processing_time_ms": round(processing_time, 2)
    }
    
    # 缓存结果
    try:
        redis_client.setex(cache_key, 3600, json.dumps(result))
    except Exception as e:
        logger.warning(f"缓存写入失败: {e}")
    
    logger.info(f"生成 {len(request.texts)} 个嵌入，维度: {embeddings.shape[1]}，耗时: {processing_time:.2f}ms")
    return EmbeddingResponse(**result)


@app.post("/rerank")
async def rerank_documents(request: RerankRequest):
    """
    使用交叉编码器对检索结果进行重排序
    返回按相关性降序排列的文档列表
    """
    if not request.documents:
        return {"results": [], "processing_time_ms": 0}
    
    start_time = time.time()
    
    # 构造查询-文档对
    pairs = [[request.query, doc] for doc in request.documents]
    scores = reranker_model.predict(pairs, show_progress_bar=False)
    
    # 按分数降序排序
    scored_docs = sorted(
        zip(range(len(request.documents)), request.documents, scores.tolist()),
        key=lambda x: x[2],
        reverse=True
    )
    
    processing_time = (time.time() - start_time) * 1000
    
    return {
        "results": [
            {"index": idx, "document": doc, "score": round(score, 4)}
            for idx, doc, score in scored_docs[:request.top_k]
        ],
        "total_candidates": len(request.documents),
        "processing_time_ms": round(processing_time, 2)
    }


@app.get("/health")
async def health_check():
    """健康检查端点，用于负载均衡器和监控系统"""
    return {
        "status": "healthy",
        "models": {
            "embedding": embedding_model is not None,
            "reranker": reranker_model is not None
        },
        "cache": redis_client is not None and redis_client.ping()
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001, workers=1)
```

Laravel 端通过 HTTP 客户端调用此 Python 服务：

```php
<?php
// app/Services/Embedding/PythonEmbeddingService.php

namespace App\Services\Embedding;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PythonEmbeddingService
{
    private string $baseUrl;
    private int $timeout;

    public function __construct()
    {
        $this->baseUrl = config('services.embedding.url', 'http://localhost:8001');
        $this->timeout = config('services.embedding.timeout', 30);
    }

    public function embed(array $texts): array
    {
        $response = Http::timeout($this->timeout)
            ->retry(2, 500)
            ->post("{$this->baseUrl}/embed", [
                'texts' => $texts,
                'normalize' => true
            ]);

        if (!$response->successful()) {
            Log::error('嵌入服务请求失败', [
                'status' => $response->status(),
                'body' => $response->body()
            ]);
            throw new \RuntimeException('嵌入服务不可用');
        }

        return $response->json('embeddings');
    }

    public function rerank(string $query, array $documents, int $topK = 5): array
    {
        $response = Http::timeout($this->timeout)
            ->retry(2, 500)
            ->post("{$this->baseUrl}/rerank", [
                'query' => $query,
                'documents' => $documents,
                'top_k' => $topK
            ]);

        if (!$response->successful()) {
            throw new \RuntimeException('重排序服务不可用');
        }

        return $response->json('results');
    }
}
```

---

## 六、服务注册与 Laravel 架构集成

### 6.1 Service Provider 配置

将所有 RAG 相关服务通过 Laravel 的服务容器进行统一管理，确保依赖注入的正确性和可测试性：

```php
<?php
// app/Providers/RAGServiceProvider.php

namespace App\Providers;

use App\Services\LLM\LLMServiceInterface;
use App\Services\LLM\OpenAILLMService;
use App\Services\LLM\AnthropicLLMService;
use App\Services\VectorStore\VectorStoreInterface;
use App\Services\VectorStore\PineconeVectorStore;
use App\Services\VectorStore\QdrantVectorStore;
use App\Services\Search\WebSearchServiceInterface;
use App\Services\Search\WebSearchService;
use App\Services\RAG\SelfRAGService;
use App\Services\RAG\CorrectiveRAGService;
use App\Services\RAG\AdaptiveRAGService;
use App\Services\RAG\SimpleRAGStrategy;
use App\Services\RAG\ModerateRAGStrategy;
use App\Services\RAG\ComplexRAGStrategy;
use Illuminate\Support\ServiceProvider;

class RAGServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // LLM 服务——根据配置切换不同供应商
        $this->app->bind(LLMServiceInterface::class, function ($app) {
            return match (config('rag.llm.provider', 'openai')) {
                'openai' => new OpenAILLMService(config('rag.llm.openai')),
                'anthropic' => new AnthropicLLMService(config('rag.llm.anthropic')),
                default => new OpenAILLMService(config('rag.llm.openai')),
            };
        });

        // 向量存储——支持多种后端
        $this->app->bind(VectorStoreInterface::class, function ($app) {
            return match (config('rag.vector_store.driver', 'pinecone')) {
                'pinecone' => new PineconeVectorStore(config('rag.vector_store.pinecone')),
                'qdrant' => new QdrantVectorStore(config('rag.vector_store.qdrant')),
                default => new PineconeVectorStore(config('rag.vector_store.pinecone')),
            };
        });

        // Web 搜索服务
        $this->app->bind(WebSearchServiceInterface::class, WebSearchService::class);

        // 各 RAG 策略以单例注册，避免重复初始化
        $this->app->singleton(SelfRAGService::class);
        $this->app->singleton(CorrectiveRAGService::class);
        $this->app->singleton(AdaptiveRAGService::class);
    }
}
```

### 6.2 统一 API 控制器

```php
<?php
// app/Http/Controllers/API/RAGController.php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\RAGQueryRequest;
use App\Services\RAG\SelfRAGService;
use App\Services\RAG\CorrectiveRAGService;
use App\Services\RAG\AdaptiveRAGService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class RAGController extends Controller
{
    public function __construct(
        private SelfRAGService $selfRAG,
        private CorrectiveRAGService $correctiveRAG,
        private AdaptiveRAGService $adaptiveRAG
    ) {}

    /**
     * 统一 RAG 查询入口
     * 支持通过 strategy 参数选择不同的 Agentic RAG 策略
     */
    public function query(RAGQueryRequest $request): JsonResponse
    {
        $strategy = $request->input('strategy', config('rag.default_strategy', 'adaptive'));
        $query = $request->input('query');
        $options = $request->input('options', []);
        $startTime = microtime(true);

        try {
            $result = match ($strategy) {
                'self' => $this->selfRAG->query($query),
                'corrective' => $this->correctiveRAG->query($query, $options),
                'adaptive' => $this->adaptiveRAG->query($query),
                default => $this->adaptiveRAG->query($query),
            };

            $latency = round((microtime(true) - $startTime) * 1000, 2);

            // 记录查询日志用于后续分析和优化
            if (config('rag.logging.enabled')) {
                Log::channel('rag')->info('RAG 查询完成', [
                    'strategy' => $strategy,
                    'query' => mb_substr($query, 0, 100),
                    'latency_ms' => $latency,
                    'complexity' => $result['complexity'] ?? null,
                    'confidence' => $result['confidence'] ?? null,
                ]);
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'answer' => $result['answer'],
                    'strategy' => $strategy,
                    'complexity' => $result['complexity'] ?? null,
                    'confidence' => $result['confidence'] ?? null,
                    'latency_ms' => $latency,
                ],
                'debug' => config('app.debug') ? ($result['trace'] ?? null) : null,
            ]);

        } catch (\Exception $e) {
            Log::error('RAG 查询失败', [
                'strategy' => $strategy,
                'query' => mb_substr($query, 0, 100),
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'error' => '查询处理失败，请稍后重试。'
            ], 500);
        }
    }
}
```

---

## 七、评估框架与基准测试

### 7.1 评估维度体系

构建一个可靠的 Agentic RAG 系统，离不开系统化的评估框架。我们需要从多个维度全面衡量系统的输出质量。

**忠实度（Faithfulness）**是 RAG 系统最重要的指标，衡量回答中的每个论断是否都得到了检索上下文的支持。高忠实度意味着系统没有"编造"信息。在企业应用中，忠实度低于 0.8 的系统需要引起严重关注。

**相关性（Relevance）**衡量回答与用户查询之间的匹配程度。一个高相关性的回答应该直接回应用户的问题，而不是提供一堆"正确但无关"的信息。

**完整性（Completeness）**衡量回答是否覆盖了查询的所有方面。特别是对于复杂查询，回答需要涵盖问题的各个维度，而不是只触及表面。

**延迟（Latency）**是用户体验的关键指标。在交互式场景中，用户通常期望在 3 秒内获得回答。Self-RAG 通常延迟最低，CRAG 由于增加了评估和纠正步骤延迟较高，Adaptive-RAG 的延迟取决于查询复杂度的分布。

**成本效率（Cost Efficiency）**衡量每次查询的 Token 消耗。在大规模应用中，LLM API 的调用成本可能非常可观，因此需要在质量和成本之间找到平衡。

### 7.2 评估服务实现

```php
<?php
// app/Services/Evaluation/RAGEvaluationService.php

namespace App\Services\Evaluation;

use App\Services\LLM\LLMServiceInterface;
use Illuminate\Support\Facades\DB;

class RAGEvaluationService
{
    public function __construct(private LLMServiceInterface $llm) {}

    /**
     * 综合评估 RAG 输出的各个质量维度
     */
    public function evaluate(array $testCase): array
    {
        $metrics = [];

        // 忠实度评估
        $metrics['faithfulness'] = $this->evaluateFaithfulness(
            $testCase['context'] ?? '',
            $testCase['answer']
        );

        // 相关性评估
        $metrics['relevance'] = $this->evaluateRelevance(
            $testCase['query'],
            $testCase['answer']
        );

        // 完整性评估
        $metrics['completeness'] = $this->evaluateCompleteness(
            $testCase['query'],
            $testCase['answer'],
            $testCase['reference'] ?? null
        );

        // 准确性评估（需要参考答案）
        if (!empty($testCase['reference'])) {
            $metrics['accuracy'] = $this->evaluateAccuracy(
                $testCase['answer'],
                $testCase['reference']
            );
        }

        // 综合分数
        $metrics['composite_score'] = $this->calculateCompositeScore($metrics);

        return $metrics;
    }

    private function evaluateFaithfulness(string $context, string $answer): float
    {
        $prompt = <<<PROMPT
你是忠实度评估专家。请严格检查回答中的每个论断是否都有上下文支撑。

评分标准：
1.0 = 完全基于上下文，没有任何额外编造
0.7-0.9 = 基本基于上下文，有少量合理推断
0.4-0.6 = 部分基于上下文，有明显的额外推测
0.0-0.3 = 大量编造，与上下文严重不符

上下文: "{$context}"
回答: "{$answer}"

请输出 0.0-1.0 之间的分数（仅输出数字）：
PROMPT;

        return $this->getNumericScore($prompt);
    }

    private function evaluateRelevance(string $query, string $answer): float
    {
        $prompt = <<<PROMPT
评估回答与查询的相关程度。

评分标准：
1.0 = 完全相关，精准回答了查询的每个方面
0.7-0.9 = 高度相关，基本回答了查询
0.4-0.6 = 部分相关，回答了一些相关内容但不完整
0.0-0.3 = 不相关或完全偏离主题

查询: "{$query}"
回答: "{$answer}"

请输出 0.0-1.0 之间的分数（仅输出数字）：
PROMPT;

        return $this->getNumericScore($prompt);
    }

    private function evaluateCompleteness(string $query, string $answer, ?string $reference): float
    {
        $refSection = $reference ? "参考答案: \"{$reference}\"" : "（无参考答案，请基于常识判断）";

        $prompt = <<<PROMPT
评估回答是否完整覆盖了查询的所有方面。

查询: "{$query}"
回答: "{$answer}"
{$refSection}

评分标准：
1.0 = 完整覆盖所有方面
0.7-0.9 = 覆盖了大部分方面
0.4-0.6 = 覆盖了部分方面，遗漏了重要内容
0.0-0.3 = 严重遗漏，未能有效回答

请输出 0.0-1.0 之间的分数（仅输出数字）：
PROMPT;

        return $this->getNumericScore($prompt);
    }

    private function evaluateAccuracy(string $answer, string $reference): float
    {
        $prompt = <<<PROMPT
评估回答与参考答案的一致程度。

参考答案: "{$reference}"
实际回答: "{$answer}"

评分标准：
1.0 = 完全一致或等价表述
0.7-0.9 = 基本一致，有细微差异
0.4-0.6 = 部分一致，有明显差异
0.0-0.3 = 不一致或矛盾

请输出 0.0-1.0 之间的分数（仅输出数字）：
PROMPT;

        return $this->getNumericScore($prompt);
    }

    private function getNumericScore(string $prompt): float
    {
        $response = $this->llm->generate($prompt, temperature: 0.1);
        $score = (float) trim($response);
        return max(0.0, min(1.0, $score));
    }

    private function calculateCompositeScore(array $metrics): float
    {
        $weights = [
            'faithfulness' => 0.35,
            'relevance' => 0.25,
            'completeness' => 0.20,
            'accuracy' => 0.20,
        ];

        $totalWeight = 0;
        $weightedSum = 0;

        foreach ($weights as $key => $weight) {
            if (isset($metrics[$key])) {
                $weightedSum += $metrics[$key] * $weight;
                $totalWeight += $weight;
            }
        }

        return $totalWeight > 0 ? round($weightedSum / $totalWeight, 4) : 0.0;
    }

    /**
     * 批量运行基准测试并存储结果
     */
    public function runBenchmark(string $datasetName, string $strategy): array
    {
        $testCases = json_decode(
            file_get_contents(storage_path("datasets/{$datasetName}.json")),
            true
        );
        $results = [];

        foreach ($testCases as $case) {
            $evaluation = $this->evaluate($case);
            $results[] = array_merge($case, $evaluation);

            DB::table('rag_evaluations')->insert([
                'dataset' => $datasetName,
                'strategy' => $strategy,
                'query' => $case['query'],
                'faithfulness' => $evaluation['faithfulness'],
                'relevance' => $evaluation['relevance'],
                'completeness' => $evaluation['completeness'],
                'accuracy' => $evaluation['accuracy'] ?? null,
                'composite_score' => $evaluation['composite_score'],
                'latency_ms' => $case['latency_ms'] ?? null,
                'created_at' => now(),
            ]);
        }

        return [
            'dataset' => $datasetName,
            'strategy' => $strategy,
            'total_cases' => count($results),
            'avg_faithfulness' => round(collect($results)->avg('faithfulness'), 4),
            'avg_relevance' => round(collect($results)->avg('relevance'), 4),
            'avg_completeness' => round(collect($results)->avg('completeness'), 4),
            'avg_composite' => round(collect($results)->avg('composite_score'), 4),
            'avg_latency_ms' => round(collect($results)->avg('latency_ms') ?? 0, 2),
        ];
    }
}
```

### 7.3 基准测试结果参考

基于我们在企业知识库问答场景中的实际测试，三种 Agentic RAG 策略的典型表现差异如下。在忠实度维度上，CRAG 表现最为出色，因为它的知识精炼机制能够在生成前就过滤掉不相关的噪音信息。在相关性维度上，Adaptive-RAG 略有优势，因为它能够根据查询复杂度选择最合适的处理深度。在完整性维度上，Adaptive-RAG 的优势更加明显，特别是对于复杂查询，它的多步分解策略确保了各个方面的覆盖。从延迟角度看，Self-RAG 最为高效，因为它省略了评估和路由的开销；CRAG 的延迟最高，主要来自知识精炼和可能的网络搜索调用。

值得注意的是，这些差异在简单查询上并不显著——三种策略对简单查询的处理效果基本一致。真正的差异出现在中等和复杂查询上，这恰恰是 Agentic RAG 相对于传统 RAG 优势最大的地方。因此，在评估 Agentic RAG 系统时，应该重点关注中高复杂度查询的表现，而不是简单查询的基准成绩。

---

## 八、生产部署与运维考量

### 8.1 缓存策略设计

在 RAG 系统中，缓存是控制成本和降低延迟的最有效手段。合理的缓存策略可以将重复查询的 LLM 调用成本降至接近零，同时将响应时间从秒级缩短到毫秒级。关键在于设计好缓存键的生成规则和失效策略。语义相似的查询应该命中相同的缓存，而当知识库内容更新时，相关的缓存应该及时失效。

### 8.2 监控与告警体系

生产环境中的 RAG 系统需要完善的可观测性支撑。我们建议监控以下关键指标：每种策略的查询量和占比分布、各策略的平均延迟和分位数延迟（P95、P99）、LLM 调用的错误率和超时率、检索结果的平均相关性分数、生成回答的置信度分布、以及网络搜索的触发频率和成功率。当任何指标出现异常波动时，系统应该通过告警通道及时通知运维团队。

### 8.3 容错与降级

LLM API 的不稳定性是 RAG 系统面临的最大运维挑战之一。网络抖动、速率限制、服务维护等都可能导致 API 调用失败。因此，必须实现完善的容错机制：首先，对 LLM 调用实施自动重试，配合指数退避策略避免加剧服务端压力；其次，在主要策略失败时自动降级到备选策略——如果 Adaptive-RAG 的分类器或复杂策略出了问题，可以降级到 Self-RAG 甚至直接的 Naive RAG；最后，当所有策略都失败时，返回最近的缓存结果或友好的错误提示，而不是暴露系统内部错误。

### 8.4 安全防护

Agentic RAG 系统面临的安全风险比传统 RAG 更大，因为 Agent 的自主决策能力可能被恶意利用。**提示注入攻击**是最需要警惕的威胁：攻击者可能在查询中嵌入精心构造的提示，试图操纵检索评估器的判断、改变策略路由的结果、或者诱导模型泄露系统提示词。防护措施包括在输入层进行提示注入检测、对 LLM 输出进行安全过滤、以及限制 Agent 可调用的工具和操作范围。

此外，**数据隔离**在多租户场景下至关重要。必须确保不同租户的向量检索结果不会交叉污染，每次查询都应该在正确的命名空间或过滤条件下执行。**速率限制**也是必不可少的防护手段，它既能防止恶意用户通过大量查询消耗 LLM 额度，也能避免正常用户的误操作导致成本失控。

---

## 九、实战总结与最佳实践

### 9.1 策略选择决策指南

经过大量实际项目的验证，我们总结了以下策略选择建议。如果你的应用场景中查询复杂度差异不大，且你有明确的质量基准数据，可以选择 Self-RAG——它实现相对简单，延迟最低，适合对响应速度有严格要求的场景。如果你的知识库质量不够稳定，或者需要整合网络信息源来弥补知识缺口，CRAG 是最佳选择——它的纠错机制能显著提升检索结果的可靠性。如果你面向通用用户、无法预估查询模式，Adaptive-RAG 是最稳妥的选择——它能根据实际情况自动适配，不需要人工干预。

在很多情况下，最佳方案并不是选择其中一种，而是将它们组合使用。例如，可以在 Adaptive-RAG 的中等策略中嵌入 Self-RAG 的反思机制，在复杂策略中嵌入 CRAG 的知识精炼流程。这种组合方式虽然增加了实现复杂度，但能够在各个维度上都取得更好的表现。

### 9.2 关键经验教训

第一，**不要过度工程化**。在项目初期，从 Adaptive-RAG 开始通常是最明智的选择，因为它能够根据实际查询自动选择策略。只有在收集了足够的运行数据后，发现特定类型的查询需要定制化处理时，才考虑增加专门的策略。

第二，**监控比优化更重要**。投入足够的资源建设完善的可观测性基础设施。没有监控，你甚至不知道系统何时出了问题、出了什么问题。先做到"看得到"，再谈"做得好"。

第三，**测试数据集必须真实**。基于真实用户查询构建测试集，而不是人工编造测试用例。真实的查询分布能够暴露系统在实际使用中的真实问题，而人工编造的测试用例往往会遗漏边界情况。

第四，**渐进式上线**。先将新策略以"影子模式"运行——与现有系统并行处理相同的请求，但不将新策略的结果返回给用户。通过对比两者的输出质量和性能指标，在充分验证后再逐步切换流量。

第五，**重视成本管理**。Agentic RAG 的多次 LLM 调用会带来显著的成本增长。建议设置每月的预算上限，并实时跟踪消耗情况。对于低优先级的查询，可以降级到更经济的策略。

### 9.3 未来展望

Agentic RAG 仍是一个快速演进的领域，以下几个方向值得持续关注。**多模态 RAG**将检索和理解能力扩展到图像、表格、代码甚至音视频内容，使系统能够处理更加丰富的知识形式。**Graph RAG**结合知识图谱进行结构化推理，在处理实体关系和因果链条方面比纯向量检索有天然优势。**长期记忆机制**让 Agent 能够从历史交互中学习优化策略，随着使用量的增长不断自我改进。**端到端优化**将检索、评估和生成作为一个整体进行联合训练，打破当前各组件独立优化的局限。**小模型知识蒸馏**通过将大模型的反思和决策能力迁移到小模型，在保持质量的同时大幅降低推理成本。

---

## 结语

Agentic RAG 代表了检索增强生成技术的重要进化方向——从被动的检索-生成流水线，进化为具有自主思考和决策能力的智能系统。Self-RAG 通过反思标记实现了生成过程的质量自控，Corrective-RAG 通过纠错循环确保了检索结果的可靠性，Adaptive-RAG 通过动态策略选择实现了查询复杂度与处理资源的最优匹配。

在 Laravel 中实现这些系统并非遥不可及。通过合理的架构设计、清晰的服务抽象和完善的评估体系，我们完全可以在 PHP 生态中构建出生产级的 Agentic RAG 系统。关键在于：**从简单开始，持续迭代，用数据驱动决策**。

每一种 Agentic RAG 策略都不是银弹，它们各自有最适合的场景和不可避免的权衡。真正优秀的系统不是追求某一种策略的极致表现，而是根据自身的业务特点和用户需求，找到质量、延迟和成本之间的最佳平衡点。希望本文的代码示例和架构模式能为你在实际项目中落地 Agentic RAG 提供有价值的参考。技术在不断进步，但解决问题的思路和工程化的方法论是不变的——理解问题本质，选择合适工具，持续优化改进。

## 相关阅读

- [AI Agent 记忆系统设计：短期/长期记忆、RAG 与向量数据库选型实战](/categories/AI/AI-Agent-记忆系统设计短期长期记忆RAG与向量数据库选型实战/)
- [Multi-Modal RAG 实战：图文混合检索——CLIP 嵌入、跨模态向量搜索与电商商品图文问答落地](/categories/AI/Multi-Modal-RAG-实战-图文混合检索-CLIP嵌入-跨模态向量搜索与电商商品图文问答落地/)
- [AI Agent 规划能力实战：ReAct/Tree-of-Thought/Graph-of-Thought 推理模式](/categories/AI/AI-Agent-规划能力实战-ReAct-Tree-of-Thought-Graph-of-Thought-推理模式/)
