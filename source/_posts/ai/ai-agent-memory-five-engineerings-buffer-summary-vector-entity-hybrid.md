---

title: AI Agent Memory 实战：对话记忆的五种工程实现——Buffer/Summary/Vector/Entity/Hybrid 策略的 Token
keywords: [AI Agent Memory, Buffer, Summary, Vector, Entity, Hybrid, Token, 对话记忆的五种工程实现, 策略的, AI]
date: 2026-06-10 08:06:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- AI Agent
- Memory
- 对话记忆
- Token
- 向量检索
- 知识图谱
- Laravel
description: Agent 没有记忆就没有连续性。本文对比五种对话记忆工程实现——Buffer、Summary、Vector Store、Entity Graph、Hybrid——分析各自的 Token 成本、召回精度和适用场景，并在 Laravel 中实现完整的记忆管理模块。
---



## 为什么 Agent 需要记忆工程

大语言模型本身是无状态的。每次调用都是独立的——它不知道你上一句话说了什么，除非你把历史对话塞进 prompt。这就是 Agent Memory 要解决的问题：如何在有限的 Token 窗口内，让 Agent 拥有"记忆"。

但记忆不是简单地把聊天记录全塞进去。你面对的是几个核心矛盾：

- **Token 预算有限**：GPT-4 128K 窗口听起来很大，但 System Prompt + 工具定义 + 检索结果 + 历史对话很容易吃掉 80%+ 的上下文
- **旧信息衰减**：用户 30 分钟前说的偏好和 3 天前说的需求，权重完全不同
- **检索精度 vs 成本**：精确检索需要向量存储和 Embedding，这本身就是成本
- **多轮对话的连贯性**：Agent 需要理解上下文依赖关系，而不只是"记住关键词"

本文从工程实践角度，逐一拆解五种记忆策略的实现细节、成本结构和适用场景。

## 策略一：Buffer Memory——最简单的全量记忆

Buffer Memory 是最直观的方案：把最近 N 轮对话原封不动地塞进 prompt。

### 实现原理

```php
<?php

namespace App\Services\Agent\Memory;

class BufferMemory
{
    private int $maxTurns;
    private array $history = [];

    public function __construct(int $maxTurns = 20)
    {
        $this->maxTurns = $maxTurns;
    }

    public function addMessage(string $role, string $content): void
    {
        $this->history[] = [
            'role' => $role,
            'content' => $content,
            'timestamp' => time(),
        ];

        // 保留最近 N 轮
        if (count($this->history) > $this->maxTurns * 2) {
            $this->history = array_slice($this->history, -$this->maxTurns * 2);
        }
    }

    public function getContext(): array
    {
        return $this->history;
    }

    public function estimateTokens(): int
    {
        // 粗略估算：中文 1 字 ≈ 2 tokens，英文 1 词 ≈ 1.3 tokens
        $totalChars = array_sum(array_map(fn($m) => mb_strlen($m['content']), $this->history));
        return (int) ($totalChars * 1.5);
    }

    public function buildMessages(string $systemPrompt): array
    {
        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        return array_merge($messages, $this->history);
    }
}
```

### 成本分析

| 对话轮数 | 平均消息长度 | Token 消耗 | 成本（GPT-4o, $2.5/M input） |
|---------|------------|-----------|---------------------------|
| 10 轮 | 200 字 | ~6,000 | $0.015 |
| 30 轮 | 200 字 | ~18,000 | $0.045 |
| 50 轮 | 200 字 | ~30,000 | $0.075 |
| 100 轮 | 200 字 | ~60,000 | $0.150 |

### 优缺点

**优点：**
- 实现零依赖，不需要向量数据库
- 信息无损——用户说的每句话都保留
- 检索精度 100%（因为没有检索，全量包含）

**缺点：**
- Token 消耗线性增长，20 轮对话就吃掉大量上下文
- 无法区分重要信息和闲聊噪音
- 超过窗口限制后，早期对话被直接丢弃

### 适用场景

- 对话轮数可控的短会话（客服、问答机器人）
- 对信息保真度要求极高的场景（医疗咨询记录）
- 原型验证阶段

## 策略二：Summary Memory——LLM 驱动的信息压缩

Summary Memory 用 LLM 对历史对话进行摘要，只保留关键信息。

### 实现原理

```php
<?php

namespace App\Services\Agent\Memory;

use App\Services\LLMService;

class SummaryMemory
{
    private array $history = [];
    private string $summary = '';
    private LLMService $llm;
    private int $summaryThreshold;

    public function __construct(LLMService $llm, int $summaryThreshold = 10)
    {
        $this->llm = $llm;
        $this->summaryThreshold = $summaryThreshold;
    }

    public function addMessage(string $role, string $content): void
    {
        $this->history[] = ['role' => $role, 'content' => $content];

        if (count($this->history) >= $this->summaryThreshold) {
            $this->compress();
        }
    }

    private function compress(): void
    {
        $conversationText = '';
        foreach ($this->history as $msg) {
            $speaker = $msg['role'] === 'user' ? '用户' : '助手';
            $conversationText .= "{$speaker}: {$msg['content']}\n";
        }

        $prompt = <<<PROMPT
你是一个对话摘要助手。请将以下对话压缩为简洁的摘要，保留：
1. 用户的核心需求和偏好
2. 已做出的决策和结论
3. 待办事项和未解决的问题
4. 关键的技术细节和代码片段

对话内容：
{$conversationText}

现有摘要（如果有）：
{$this->summary}

请输出更新后的摘要，控制在 500 字以内。
PROMPT;

        $this->summary = $this->llm->chat($prompt, model: 'gpt-4o-mini');
        $this->history = []; // 清空原始历史，只保留摘要
    }

    public function getContext(): array
    {
        $messages = [];
        if ($this->summary) {
            $messages[] = [
                'role' => 'system',
                'content' => "以下是之前的对话摘要：\n{$this->summary}",
            ];
        }
        // 加上未压缩的最近对话
        return array_merge($messages, $this->history);
    }

    public function getSummary(): string
    {
        return $this->summary;
    }
}
```

### 摘要质量优化

摘要不是简单地让 LLM "总结一下"。实践中需要几个优化：

```php
// 分层摘要策略：保留不同粒度的信息
private function hierarchicalCompress(): void
{
    $prompt = <<<PROMPT
请用以下结构摘要对话：

## 用户画像
- 角色/职业：
- 技术栈：
- 偏好：

## 当前任务
- 目标：
- 进度：
- 阻塞点：

## 关键决策
- [日期] 决策内容

## 待办
- [ ] 事项

## 技术细节
- 关键代码/配置/命令
PROMPT;

    $this->summary = $this->llm->chat($prompt, model: 'gpt-4o-mini');
}
```

### 成本分析

| 操作 | Token 消耗 | 频率 | 月成本（日均 100 对话） |
|-----|-----------|------|----------------------|
| 摘要生成 | ~2,000 input + ~500 output | 每 10 轮 | ~$0.75/月 |
| Buffer 对比 | ~30,000 input | 每轮 | ~$7.50/月 |

**成本节约约 90%**，但以信息损失为代价。

### 优缺点

**优点：**
- Token 消耗大幅降低
- 摘要可以持久化存储
- 支持长期记忆（摘要可以跨 session 保留）

**缺点：**
- 摘要过程有信息损失——LLM 可能丢掉它认为"不重要"的细节
- 摘要生成本身消耗 LLM 调用（延迟 + 成本）
- 摘要质量取决于 LLM 能力，需要调试 prompt

### 适用场景

- 长对话场景（技术支持、项目管理）
- 需要跨 session 保持上下文的场景
- 对成本敏感的生产环境

## 策略三：Vector Store Memory——语义检索记忆

Vector Store Memory 把每条消息 Embedding 后存入向量数据库，查询时通过语义检索找到相关记忆。

### 实现原理

```php
<?php

namespace App\Services\Agent\Memory;

use Pgvector\Laravel\Vector;
use Illuminate\Support\Facades\DB;

class VectorStoreMemory
{
    private string $conversationId;

    public function __construct(string $conversationId)
    {
        $this->conversationId = $conversationId;
    }

    public function addMessage(string $role, string $content, array $metadata = []): void
    {
        $embedding = $this->getEmbedding($content);

        DB::table('agent_memory_vectors')->insert([
            'conversation_id' => $this->conversationId,
            'role' => $role,
            'content' => $content,
            'embedding' => $embedding,
            'metadata' => json_encode(array_merge($metadata, [
                'timestamp' => now()->toIso8601String(),
                'token_count' => $this->estimateTokens($content),
            ])),
            'created_at' => now(),
        ]);
    }

    public function searchRelevant(string $query, int $topK = 10): array
    {
        $queryEmbedding = $this->getEmbedding($query);

        $results = DB::select("
            SELECT
                role, content, metadata,
                1 - (embedding <=> ?::vector) as similarity
            FROM agent_memory_vectors
            WHERE conversation_id = ?
            ORDER BY embedding <=> ?::vector
            LIMIT ?
        ", [$queryEmbedding, $this->conversationId, $queryEmbedding, $topK]);

        return array_map(function ($row) {
            return [
                'role' => $row->role,
                'content' => $row->content,
                'similarity' => $row->similarity,
                'metadata' => json_decode($row->metadata, true),
            ];
        }, $results);
    }

    public function getContext(string $currentQuery): array
    {
        $relevant = $this->searchRelevant($currentQuery, topK: 10);

        // 按时间排序，确保对话连贯性
        usort($relevant, fn($a, $b) =>
            $a['metadata']['timestamp'] <=> $b['metadata']['timestamp']
        );

        $context = [];
        foreach ($relevant as $msg) {
            $context[] = [
                'role' => $msg['role'],
                'content' => $msg['content'],
            ];
        }

        return $context;
    }

    private function getEmbedding(string $text): string
    {
        // 使用 OpenAI text-embedding-3-small
        $response = Http::withToken(config('services.openai.api_key'))
            ->post('https://api.openai.com/v1/embeddings', [
                'model' => 'text-embedding-3-small',
                'input' => $text,
            ]);

        $vector = $response->json('data.0.embedding');
        return '[' . implode(',', $vector) . ']';
    }

    private function estimateTokens(string $text): int
    {
        return (int) (mb_strlen($text) * 1.5);
    }
}
```

### PostgreSQL + pgvector 部署

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建记忆表
CREATE TABLE agent_memory_vectors (
    id BIGSERIAL PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 索引：HNSW 算法，比 IVFFlat 更适合动态数据
CREATE INDEX idx_memory_embedding
    ON agent_memory_vectors
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- 查询性能：百万级数据 < 50ms
CREATE INDEX idx_memory_conversation
    ON agent_memory_vectors (conversation_id, created_at);
```

### 成本分析

| 组件 | 成本 | 说明 |
|-----|------|------|
| Embedding 生成 | $0.02/M tokens | text-embedding-3-small |
| pgvector 存储 | ~$0.10/GB/月 | RDS 实例费用 |
| 向量检索 | ~$0.001/次 | 数据库查询成本 |
| **总计（10万条记忆）** | **~$3/月** | 包含存储和检索 |

### 优缺点

**优点：**
- 基于语义检索，能找到"意思相近但用词不同"的信息
- 支持海量记忆存储（百万级）
- 检索精度高，可以调节 topK

**缺点：**
- 需要 Embedding 生成成本
- 需要维护向量数据库
- 时序信息需要额外处理（向量检索不保证时间顺序）

### 适用场景

- 需要从大量历史对话中检索相关信息
- 知识密集型 Agent（研究助手、文档搜索）
- 多用户场景（每个用户独立的向量空间）

## 策略四：Entity Graph Memory——结构化的知识图谱

Entity Graph Memory 不存储原始对话，而是提取结构化的实体和关系，构建知识图谱。

### 实现原理

```php
<?php

namespace App\Services\Agent\Memory;

use App\Services\LLMService;

class EntityGraphMemory
{
    private LLMService $llm;

    public function __construct(LLMService $llm)
    {
        $this->llm = $llm;
    }

    public function extractEntities(string $conversation): array
    {
        $prompt = <<<PROMPT
从以下对话中提取结构化信息。输出 JSON 格式：

{
  "entities": [
    {
      "name": "实体名称",
      "type": "person|project|technology|concept|preference",
      "attributes": {"key": "value"},
      "mentions": ["对话中提到的原文"]
    }
  ],
  "relations": [
    {
      "source": "实体A",
      "target": "实体B",
      "type": "works_on|prefers|uses|depends_on|mentioned_in",
      "context": "关系的上下文说明"
    }
  ],
  "decisions": [
    {
      "topic": "决策主题",
      "decision": "最终决定",
      "alternatives": ["被否决的选项"],
      "reasoning": "决策理由",
      "date": "YYYY-MM-DD"
    }
  ],
  "facts": [
    {
      "content": "事实内容",
      "category": "technical|personal|project|preference",
      "confidence": 0.0-1.0
    }
  ]
}

对话内容：
{$conversation}
PROMPT;

        $response = $this->llm->chat($prompt, model: 'gpt-4o');
        return json_decode($response, true);
    }

    public function buildContext(string $currentQuery, array $entities): string
    {
        // 查询相关实体
        $relevantEntities = $this->findRelevantEntities($currentQuery, $entities);

        $context = "## 已知信息\n\n";

        // 分类输出
        $byType = [];
        foreach ($relevantEntities as $entity) {
            $byType[$entity['type']][] = $entity;
        }

        foreach ($byType as $type => $items) {
            $context .= "### {$type}\n";
            foreach ($items as $item) {
                $attrs = $item['attributes'] ?? [];
                $attrStr = $attrs ? ' (' . http_build_query($attrs, '', ', ') . ')' : '';
                $context .= "- {$item['name']}{$attrStr}\n";
            }
            $context .= "\n";
        }

        // 添加关系
        $relevantRelations = $this->findRelevantRelations($currentQuery, $entities);
        if ($relevantRelations) {
            $context .= "### 关系\n";
            foreach ($relevantRelations as $rel) {
                $context .= "- {$rel['source']} --{$rel['type']}--> {$rel['target']}: {$rel['context']}\n";
            }
        }

        // 添加决策历史
        $relevantDecisions = $this->findRelevantDecisions($currentQuery, $entities);
        if ($relevantDecisions) {
            $context .= "\n### 历史决策\n";
            foreach ($relevantDecisions as $dec) {
                $context .= "- [{$dec['date']}] {$dec['topic']}: {$dec['decision']}\n";
            }
        }

        return $context;
    }

    private function findRelevantEntities(string $query, array $entities): array
    {
        // 简单的关键词匹配 + LLM 辅助筛选
        $entityList = array_map(fn($e) => $e['name'] . ' (' . $e['type'] . ')', $entities['entities'] ?? []);
        $entityStr = implode("\n", $entityList);

        $prompt = <<<PROMPT
当前查询：{$query}

以下是从历史对话中提取的实体：
{$entityStr}

请选出与当前查询最相关的实体（最多 15 个），输出实体名称列表（JSON 数组）。
PROMPT;

        $relevant = $this->llm->chat($prompt, model: 'gpt-4o-mini');
        $relevantNames = json_decode($relevant, true);

        return array_filter(
            $entities['entities'] ?? [],
            fn($e) => in_array($e['name'], $relevantNames)
        );
    }

    private function findRelevantRelations(string $query, array $entities): array
    {
        // 类似地筛选相关关系
        return array_slice($entities['relations'] ?? [], 0, 10);
    }

    private function findRelevantDecisions(string $query, array $entities): array
    {
        return array_slice($entities['decisions'] ?? [], 0, 5);
    }
}
```

### 知识图谱存储

```sql
-- 实体表
CREATE TABLE agent_entities (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(64) NOT NULL,
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(conversation_id, name, type)
);

-- 关系表
CREATE TABLE agent_relations (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL,
    source_entity_id INT REFERENCES agent_entities(id),
    target_entity_id INT REFERENCES agent_entities(id),
    relation_type VARCHAR(64) NOT NULL,
    context TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 事实表
CREATE TABLE agent_facts (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    source_turn INT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 成本分析

| 操作 | Token 消耗 | 频率 |
|-----|-----------|------|
| 实体提取（GPT-4o） | ~3,000 input + ~1,000 output | 每 5 轮 |
| 相关性筛选（GPT-4o-mini） | ~1,000 input + ~200 output | 每轮 |

**月成本约 $2-5**（日均 100 对话），但提供了结构化的知识检索能力。

### 优缺点

**优点：**
- 信息高度结构化，检索效率极高
- 支持复杂查询（"用户之前在项目 X 中用过什么技术栈"）
- 知识可跨 session 累积
- Token 消耗可控

**缺点：**
- 实体提取质量依赖 LLM
- 需要维护实体去重和合并逻辑
- 实现复杂度最高

### 适用场景

- 长期项目管理 Agent（记住项目决策和技术选型）
- 个人助手（记住用户偏好和习惯）
- 需要推理能力的场景（基于关系做推断）

## 策略五：Hybrid Memory——生产级混合架构

Hybrid Memory 组合多种策略，根据不同场景选择最优路径。

### 架构设计

```php
<?php

namespace App\Services\Agent\Memory;

use App\Services\LLMService;
use App\Services\Agent\Memory\BufferMemory;
use App\Services\Agent\Memory\SummaryMemory;
use App\Services\Agent\Memory\VectorStoreMemory;
use App\Services\Agent\Memory\EntityGraphMemory;

class HybridMemory
{
    private BufferMemory $buffer;
    private SummaryMemory $summary;
    private VectorStoreMemory $vector;
    private EntityGraphMemory $entity;
    private LLMService $llm;

    private const STRATEGIES = [
        'immediate' => 'buffer',      // 最近 5 轮：原样保留
        'short_term' => 'vector',     // 5-50 轮：向量检索
        'long_term' => 'summary',     // 50 轮以上：摘要
        'knowledge' => 'entity',      // 结构化知识：实体图谱
    ];

    public function __construct(LLMService $llm)
    {
        $this->llm = $llm;
        $this->buffer = new BufferMemory(maxTurns: 5);
        $this->summary = new SummaryMemory($llm, summaryThreshold: 50);
        $this->vector = new VectorStoreMemory();
        $this->entity = new EntityGraphMemory($llm);
    }

    public function addMessage(string $role, string $content, array $metadata = []): void
    {
        // 所有策略都记录
        $this->buffer->addMessage($role, $content);
        $this->summary->addMessage($role, $content);
        $this->vector->addMessage($role, $content, $metadata);

        // 每 10 轮提取一次实体
        if ($this->buffer->getTurnCount() % 10 === 0) {
            $recentConversation = $this->buffer->getRecentConversation(20);
            $entities = $this->entity->extractEntities($recentConversation);
            $this->saveEntities($entities);
        }
    }

    public function buildContext(string $currentQuery): array
    {
        $context = [];

        // 1. 最近对话：Buffer（保真度最高）
        $immediate = $this->buffer->getContext();
        if ($immediate) {
            $context['immediate'] = $immediate;
        }

        // 2. 相关历史：Vector Store（语义检索）
        $relevant = $this->vector->searchRelevant($currentQuery, topK: 8);
        if ($relevant) {
            $context['relevant_history'] = $relevant;
        }

        // 3. 长期摘要：Summary（压缩的历史）
        $summary = $this->summary->getSummary();
        if ($summary) {
            $context['summary'] = $summary;
        }

        // 4. 结构化知识：Entity Graph
        $entities = $this->entity->extractEntities(
            $this->buffer->getRecentConversation(10)
        );
        $entityContext = $this->entity->buildContext($currentQuery, $entities);
        if ($entityContext) {
            $context['knowledge'] = $entityContext;
        }

        return $context;
    }

    public function formatForPrompt(string $currentQuery): string
    {
        $context = $this->buildContext($currentQuery);
        $sections = [];

        if (!empty($context['immediate'])) {
            $turns = array_map(
                fn($m) => ($m['role'] === 'user' ? '用户' : '助手') . ': ' . $m['content'],
                $context['immediate']
            );
            $sections[] = "## 最近对话\n" . implode("\n", $turns);
        }

        if (!empty($context['relevant_history'])) {
            $relevant = array_map(
                fn($m) => sprintf('[相关度 %.0f%%] %s: %s',
                    $m['similarity'] * 100,
                    $m['role'] === 'user' ? '用户' : '助手',
                    $m['content']
                ),
                $context['relevant_history']
            );
            $sections[] = "## 相关历史\n" . implode("\n", $relevant);
        }

        if (!empty($context['summary'])) {
            $sections[] = "## 历史摘要\n" . $context['summary'];
        }

        if (!empty($context['knowledge'])) {
            $sections[] = $context['knowledge'];
        }

        return implode("\n\n", $sections);
    }
}
```

### 智能路由决策

```php
<?php

namespace App\Services\Agent\Memory;

class MemoryRouter
{
    /**
     * 根据查询类型和对话状态，决定使用哪些记忆策略
     */
    public static function route(string $query, array $conversationState): array
    {
        $strategies = [];

        // 规则 1：所有查询都需要最近上下文
        $strategies[] = 'buffer';

        // 规则 2：如果查询涉及历史信息，启用向量检索
        $historicalKeywords = ['之前', '上次', '以前', '说过', '提到', '决定', '选择'];
        if (self::containsKeywords($query, $historicalKeywords)) {
            $strategies[] = 'vector';
        }

        // 规则 3：如果对话超过 20 轮，启用摘要
        if ($conversationState['turn_count'] > 20) {
            $strategies[] = 'summary';
        }

        // 规则 4：如果查询涉及实体关系，启用知识图谱
        $entityKeywords = ['谁', '哪个项目', '什么技术', '为什么选择', '和谁'];
        if (self::containsKeywords($query, $entityKeywords)) {
            $strategies[] = 'entity';
        }

        return $strategies;
    }

    private static function containsKeywords(string $text, array $keywords): bool
    {
        foreach ($keywords as $keyword) {
            if (str_contains($text, $keyword)) {
                return true;
            }
        }
        return false;
    }
}
```

## 五种策略对比

| 维度 | Buffer | Summary | Vector | Entity | Hybrid |
|-----|--------|---------|--------|--------|--------|
| **实现复杂度** | ⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Token 成本** | 高 | 低 | 中 | 中 | 可控 |
| **信息保真度** | 100% | ~70% | ~90% | ~80% | ~95% |
| **检索延迟** | 0ms | 0ms | 10-50ms | 50-200ms | 10-100ms |
| **存储需求** | 无 | 低 | 高 | 中 | 高 |
| **跨 session** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **推理能力** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **适用规模** | <50 轮 | 不限 | 不限 | 不限 | 不限 |

## 踩坑记录

### 1. 向量检索的时间衰减问题

向量检索返回的是"语义最相关"的结果，但对话有时间维度。用户 10 分钟前说的偏好应该比 3 天前的更"新鲜"。

**解决方案：** 混合排序

```php
// 向量相似度 + 时间衰减的混合分数
function hybridScore(float $similarity, string $timestamp): float
{
    $hoursAgo = (time() - strtotime($timestamp)) / 3600;
    $timeDecay = exp(-$hoursAgo / 72); // 72 小时半衰期

    return 0.7 * $similarity + 0.3 * $timeDecay;
}
```

### 2. 摘要累积漂移

Summary Memory 的摘要会被反复压缩，每次压缩都可能丢失信息。经过 10 次压缩后，摘要可能完全偏离原始内容。

**解决方案：** 分层摘要 + 摘要锚点

```php
// 不是覆盖式压缩，而是追加式分层
class LayeredSummary
{
    private array $layers = []; // 每层摘要独立存储
    private int $maxLayers = 5;

    public function addLayer(string $summary): void
    {
        $this->layers[] = [
            'content' => $summary,
            'created_at' => now(),
            'turn_range' => $this->getCurrentTurnRange(),
        ];

        // 超过最大层数时，压缩最旧的两层
        if (count($this->layers) > $this->maxLayers) {
            $this->compressOldestLayers();
        }
    }

    public function getFullContext(): string
    {
        return implode("\n---\n", array_map(
            fn($l) => "[{$l['turn_range']}] {$l['content']}",
            $this->layers
        ));
    }
}
```

### 3. Entity Graph 的实体冲突

不同对话中可能提取出相同但表述不同的实体（"PHP 8.4" vs "PHP8.4" vs "最新版 PHP"）。

**解决方案：** 实体归一化

```php
public function normalizeEntity(string $name, string $type): string
{
    // 1. 去除多余空格
    $name = preg_replace('/\s+/', ' ', trim($name));

    // 2. 类型特定的归一化
    if ($type === 'technology') {
        // "PHP 8.4" → "PHP 8.4"
        $name = preg_replace('/(PHP|Laravel|MySQL)\s*(\d)/', '$1 $2', $name);
    }

    // 3. 查找已有实体
    $existing = DB::table('agent_entities')
        ->where('type', $type)
        ->whereRaw('LOWER(name) = LOWER(?)', [$name])
        ->first();

    return $existing->name ?? $name;
}
```

### 4. 成本失控

Hybrid Memory 如果不加控制，每轮对话可能触发多次 LLM 调用（摘要 + 实体提取 + 相关性筛选），成本快速攀升。

**解决方案：** 限流和缓存

```php
class MemoryCostGuard
{
    private int $dailyLlmCalls = 0;
    private int $maxDailyCalls = 500;
    private Cache $cache;

    public function shouldExtractEntities(): bool
    {
        // 每天最多 50 次实体提取
        $todayCalls = $this->cache->get('memory:entity_calls:' . date('Y-m-d'), 0);
        return $todayCalls < 50;
    }

    public function shouldSummarize(int $turnCount): bool
    {
        // 只在超过阈值且距离上次摘要 > 20 轮时才触发
        $lastSummaryTurn = $this->cache->get('memory:last_summary_turn', 0);
        return $turnCount > 50 && ($turnCount - $lastSummaryTurn) > 20;
    }

    public function recordLlmCall(string $type): void
    {
        $this->cache->increment("memory:{$type}_calls:" . date('Y-m-d'));
        $this->cache->increment("memory:total_calls:" . date('Y-m-d'));
    }
}
```

## 实际选型建议

**个人项目 / 原型阶段：** Buffer Memory 就够了。简单可靠，没有额外依赖。

**SaaS 产品 / 多用户场景：** Vector Store Memory。每个用户独立的向量空间，支持长期记忆。

**AI 助手 / 长期陪伴场景：** Hybrid Memory。Buffer 处理即时对话，Vector 处理相关检索，Summary 处理长期记忆，Entity 处理结构化知识。

**成本敏感场景：** Summary Memory + 缓存。LLM 调用集中在摘要生成，日常对话零额外成本。

核心原则：**没有银弹，只有适合场景的权衡。** 从 Buffer 开始，遇到瓶颈再升级到更复杂的策略。不要为了"架构优雅"而过早引入不需要的复杂度。

## 总结

五种记忆策略本质上是在回答同一个问题：**如何在有限的 Token 窗口内，最大化 Agent 对历史信息的利用效率。**

Buffer 用空间换保真度，Summary 用压缩换成本，Vector 用检索换精度，Entity 用结构换推理能力，Hybrid 则是在所有维度上做平衡。生产环境中，大部分场景最终都会走向 Hybrid——因为单一策略无法同时满足即时响应、长期记忆、语义检索和结构化推理的需求。

选型的关键不是"哪个最先进"，而是"我的场景最需要什么"。然后从最简单的实现开始，用真实数据验证，逐步演进。
