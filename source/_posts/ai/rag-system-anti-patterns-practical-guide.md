---

title: RAG System Anti-Patterns 实战：Chunking 陷阱、幻觉传播、检索质量下降、向量漂移——10 个常见错误与系统性修复方案
keywords: [RAG System Anti, Patterns, Chunking, 陷阱, 幻觉传播, 检索质量下降, 向量漂移, 个常见错误与系统性修复方案, AI]
date: 2026-06-10 09:21:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- RAG
- LLM
- 数据库
- Chunking
- 幻觉
- 检索增强生成
- Laravel
description: RAG 系统上线后检索质量越来越差？本文从 Chunking 策略、幻觉传播链路、检索质量退化、向量漂移四个维度，拆解 10 个真实踩过的 Anti-Pattern，给出可落地的修复方案和 PHP 代码示例。
---



## 为什么写这篇

RAG（Retrieval-Augmented Generation）是 2025-2026 年 LLM 应用的标配架构。但很多团队的 RAG 系统在上线 1-3 个月后，检索质量会明显下降——用户问同样的问题，回答越来越不靠谱。

这不是 LLM 的问题，是 RAG 工程的问题。

我在实际项目中踩过大量坑，总结出 10 个最常见的 Anti-Pattern。每个都会给出：问题现象 → 根因分析 → 修复方案 → 代码示例。

---

## 一、Chunking 陷阱（Anti-Pattern #1-#3）

### Anti-Pattern #1：固定长度切片，不考虑语义边界

**现象**：同一个知识点被切成两半，检索到的 chunk 只有前半段或后半段，LLM 回答不完整。

**错误实现**：

```php
// ❌ 按固定字符数切片
function naiveChunk(string $text, int $size = 500): array
{
    $chunks = [];
    for ($i = 0; $i < strlen($text); $i += $size) {
        $chunks[] = substr($text, $i, $size);
    }
    return $chunks;
}
```

**根因**：文本的语义边界（段落、章节、代码块）与固定长度无关。一个段落可能 200 字，也可能 2000 字。

**修复方案：语义感知切片 + 重叠窗口**

```php
class SemanticChunker
{
    private int $maxChunkSize;
    private int $overlapSize;
    private array $separators = ["\n## ", "\n### ", "\n\n", "\n", "。", "；"];

    public function __construct(int $maxChunkSize = 800, int $overlapSize = 100)
    {
        $this->maxChunkSize = $maxChunkSize;
        $this->overlapSize = $overlapSize;
    }

    public function chunk(string $text): array
    {
        // 先按语义分隔符拆分
        $segments = $this->splitBySeparators($text);
        $chunks = [];
        $current = '';
        $overlap = '';

        foreach ($segments as $segment) {
            $candidate = $current . $segment;

            if (mb_strlen($candidate) > $this->maxChunkSize && $current !== '') {
                // 保存当前 chunk，带上 overlap
                $chunks[] = $overlap . $current;
                // 取末尾作为 overlap
                $overlap = mb_substr($current, -$this->overlapSize);
                $current = $segment;
            } else {
                $current = $candidate;
            }
        }

        if ($current !== '') {
            $chunks[] = $overlap . $current;
        }

        return $chunks;
    }

    private function splitBySeparators(string $text): array
    {
        $separator = $this->separators[0];
        foreach ($this->separators as $sep) {
            if (mb_strpos($text, $sep) !== false) {
                $separator = $sep;
                break;
            }
        }

        $parts = explode($separator, $text);
        // 把分隔符加回去
        return array_map(fn($p) => $separator . $p, $parts);
    }
}
```

**关键点**：

- `maxChunkSize` 设为 800-1200 字（中文），英文可以 1000-1500 tokens
- `overlapSize` 设为 chunk 大小的 10%-15%，太大会浪费 token，太小会丢上下文
- 分隔符优先级：标题 > 段落 > 句号 > 换行

---

### Anti-Pattern #2：忽略文档结构，把目录和正文混在一起

**现象**：检索到的 chunk 里混着目录、页码、版权声明，污染了 LLM 的上下文。

**错误实现**：

```php
// ❌ 直接全文切片，不做预处理
$chunks = $chunker->chunk(file_get_contents('document.pdf'));
```

**根因**：PDF/Word 文档导出后包含大量结构噪声：目录条目、页眉页脚、水印文字、参考文献格式。

**修复方案：文档预处理 Pipeline**

```php
class DocumentPreprocessor
{
    // 噪声模式列表
    private array $noisePatterns = [
        '/^目录\s*$/m',
        '/^\d+\.\d+\s+\S+\s+\d+\s*$/m',  // "1.2 标题名 15"
        '/^第?\s*\d+\s*页/m',
        '/^Page\s+\d+/im',
        '/^版权所有.*$/m',
        '/^©.*$/m',
        '/^\s*-\s*\d+\s*-\s*$/m',           // "- 3 -"
    ];

    public function preprocess(string $raw): string
    {
        // 1. 去除噪声
        $text = $raw;
        foreach ($this->noisePatterns as $pattern) {
            $text = preg_replace($pattern, '', $text);
        }

        // 2. 合并多余空行
        $text = preg_replace('/\n{3,}/', "\n\n", $text);

        // 3. 提取结构信息（保留标题层级）
        $sections = $this->extractSections($text);

        // 4. 按 section 组织文本
        $cleaned = '';
        foreach ($sections as $section) {
            $cleaned .= $section['title'] . "\n" . $section['content'] . "\n\n";
        }

        return trim($cleaned);
    }

    private function extractSections(string $text): array
    {
        $sections = [];
        $currentTitle = 'Introduction';
        $currentContent = '';

        foreach (explode("\n", $text) as $line) {
            if (preg_match('/^(#{1,4})\s+(.+)$/', $line, $m)) {
                if ($currentContent !== '') {
                    $sections[] = [
                        'title' => $currentTitle,
                        'content' => trim($currentContent),
                    ];
                }
                $currentTitle = $m[2];
                $currentContent = '';
            } else {
                $currentContent .= $line . "\n";
            }
        }

        if ($currentContent !== '') {
            $sections[] = [
                'title' => $currentTitle,
                'content' => trim($currentContent),
            ];
        }

        return $sections;
    }
}
```

---

### Anti-Pattern #3：Chunk 元数据丢失，检索后无法溯源

**现象**：用户问"这个数据来自哪份文档"，系统答不上来。或者同一个知识点在多份文档里出现，无法区分权威来源。

**修复方案：Chunk 携带完整元数据**

```php
class ChunkMetadata
{
    public function __construct(
        public readonly string $docId,
        public readonly string $docTitle,
        public readonly string $section,
        public readonly int $chunkIndex,
        public readonly int $totalChunks,
        public readonly string $source,       // 文件路径或 URL
        public readonly ?string $author = null,
        public readonly ?string $updatedAt = null,
        public readonly ?string $chunkType = null, // 'text', 'code', 'table'
    ) {}

    public function toEmbeddingPrefix(): string
    {
        // 将元数据编码为 embedding 前缀，提升检索精度
        return "[{$this->docTitle}] [{$this->section}] ";
    }

    public function toArray(): array
    {
        return get_object_vars($this);
    }
}

// 存储时带上元数据
$vectorStore->upsert([
    'id' => md5($chunk->content),
    'vector' => $embedding,
    'metadata' => $chunkMetadata->toArray(),
    'text' => $chunk->content,
]);
```

---

## 二、幻觉传播链路（Anti-Pattern #4-#5）

### Anti-Pattern #4：检索结果不相关但 LLM 硬编故事

**现象**：用户问"你们的退款政策是什么"，检索到了"配送政策"的 chunk，LLM 基于配送政策编了一个退款政策。

**根因**：LLM 有"回答偏见"——即使上下文不包含答案，也会尝试编造一个看起来合理的回答。

**修复方案：相关性阈值 + 兜底策略**

```php
class RetrievalGuard
{
    private float $relevanceThreshold;
    private int $minResults;

    public function __construct(float $threshold = 0.65, int $minResults = 2)
    {
        $this->relevanceThreshold = $threshold;
        $this->minResults = $minResults;
    }

    public function filterResults(array $results): array
    {
        // 过滤低相关性结果
        $filtered = array_filter(
            $results,
            fn($r) => $r['score'] >= $this->relevanceThreshold
        );

        return array_values($filtered);
    }

    public function shouldFallback(array $filteredResults): bool
    {
        return count($filteredResults) < $this->minResults;
    }

    public function buildPrompt(string $query, array $results): string
    {
        $filtered = $this->filterResults($results);

        if ($this->shouldFallback($filtered)) {
            // 兜底：明确告诉 LLM 没有找到相关信息
            return <<<PROMPT
用户问题：{$query}

检索结果：未找到足够相关的信息。

请严格按照以下规则回答：
1. 如果你不确定答案，请明确告知用户"根据现有资料，我无法确认这个信息"
2. 不要猜测或编造任何信息
3. 建议用户联系人工客服获取准确信息

PROMPT;
        }

        $context = implode("\n\n---\n\n", array_map(
            fn($r) => "[来源: {$r['metadata']['docTitle']}]\n{$r['text']}",
            $filtered
        ));

        return <<<PROMPT
基于以下参考资料回答用户问题。如果参考资料中没有相关信息，请明确说明。

参考资料：
{$context}

用户问题：{$query}

PROMPT;
    }
}
```

**关键点**：

- `relevanceThreshold` 需要根据业务场景调优，客服场景建议 0.7+，知识库场景 0.6+
- 兜底 prompt 要明确约束 LLM 的行为，不能模棱两可

---

### Anti-Pattern #5：多轮对话中幻觉累积放大

**现象**：对话第 1 轮 LLM 回答有小错误，第 2 轮用户追问，LLM 基于第 1 轮的错误继续编造，错误越来越离谱。

**根因**：RAG 系统通常只对当前轮 query 做检索，但 LLM 的上下文包含了历史轮次的错误回答。

**修复方案：对话感知检索 + 历史回答校验**

```php
class ConversationAwareRetriever
{
    private EmbeddingService $embedder;
    private VectorStore $store;

    public function retrieveWithHistory(
        string $currentQuery,
        array $conversationHistory, // [{role, content}]
        int $maxHistoryTokens = 500
    ): array {
        // 1. 从历史中提取关键信息，构建扩展 query
        $expandedQuery = $this->expandQueryWithHistory(
            $currentQuery,
            $conversationHistory,
            $maxHistoryTokens
        );

        // 2. 对扩展 query 做检索
        $queryVector = $this->embedder->embed($expandedQuery);
        $results = $this->store->search($queryVector, limit: 10);

        // 3. 对历史回答中的事实声明做交叉验证
        $validatedResults = $this->crossValidateWithHistory(
            $results,
            $conversationHistory
        );

        return $validatedResults;
    }

    private function expandQueryWithHistory(
        string $query,
        array $history,
        int $maxTokens
    ): string {
        // 只取最近 3 轮，避免 query 太长
        $recentHistory = array_slice($history, -6); // 3 轮 = 6 条消息

        $context = '';
        foreach ($recentHistory as $msg) {
            if ($msg['role'] === 'user') {
                $context .= "用户: {$msg['content']}\n";
            }
        }

        return $context . "当前问题: {$query}";
    }

    private function crossValidateWithHistory(
        array $results,
        array $history
    ): array {
        // 提取历史 assistant 回答中的关键声明
        $claims = [];
        foreach ($history as $msg) {
            if ($msg['role'] === 'assistant') {
                // 简单提取：取包含数字或专有名词的句子
                $sentences = preg_split('/[。！？]/', $msg['content']);
                foreach ($sentences as $s) {
                    if (preg_match('/\d+|[A-Z][a-z]+/', $s)) {
                        $claims[] = trim($s);
                    }
                }
            }
        }

        // 如果检索结果与历史声明矛盾，标记为需要修正
        foreach ($results as &$result) {
            $result['conflictsWithHistory'] = false;
            foreach ($claims as $claim) {
                $similarity = $this->computeContradiction(
                    $result['text'],
                    $claim
                );
                if ($similarity > 0.8) {
                    $result['conflictsWithHistory'] = true;
                    break;
                }
            }
        }

        return $results;
    }
}
```

---

## 三、检索质量退化（Anti-Pattern #6-#8）

### Anti-Pattern #6：Embedding 模型与查询类型不匹配

**现象**：用户输入短 query（"退款流程"），但文档是长文本。Embedding 空间里短文本和长文本的向量分布不同，导致检索不准。

**根因**：大多数 Embedding 模型对短文本和长文本的编码行为不同。短 query 的向量倾向于聚集在空间中心，长文档的向量更分散。

**修复方案：Hybrid Search（混合检索）**

```php
class HybridRetriever
{
    private VectorStore $vectorStore;
    private SearchIndex $bm25Index;
    private float $vectorWeight;
    private float $bm25Weight;

    public function __construct(
        VectorStore $vectorStore,
        SearchIndex $bm25Index,
        float $vectorWeight = 0.6,
        float $bm25Weight = 0.4
    ) {
        $this->vectorStore = $vectorStore;
        $this->bm25Index = $bm25Index;
        $this->vectorWeight = $vectorWeight;
        $this->bm25Weight = $bm25Weight;
    }

    public function search(string $query, int $limit = 10): array
    {
        // 向量检索
        $embedding = $this->embed($query);
        $vectorResults = $this->vectorStore->search($embedding, $limit * 2);

        // BM25 关键词检索
        $bm25Results = $this->bm25Index->search($query, $limit * 2);

        // RRF (Reciprocal Rank Fusion) 融合
        return $this->reciprocalRankFusion(
            $vectorResults,
            $bm25Results,
            $limit
        );
    }

    private function reciprocalRankFusion(
        array $rankedList1,
        array $rankedList2,
        int $limit,
        int $k = 60
    ): array {
        $scores = [];

        foreach ($rankedList1 as $rank => $item) {
            $id = $item['id'];
            $scores[$id] = ($scores[$id] ?? 0)
                + $this->vectorWeight / ($k + $rank + 1);
            $scores[$id . '_data'] = $item;
        }

        foreach ($rankedList2 as $rank => $item) {
            $id = $item['id'];
            $scores[$id] = ($scores[$id] ?? 0)
                + $this->bm25Weight / ($k + $rank + 1);
            $scores[$id . '_data'] = $item;
        }

        // 按融合分数排序
        $fused = [];
        foreach ($scores as $key => $score) {
            if (str_ends_with($key, '_data')) continue;
            $fused[] = [
                'id' => $key,
                'score' => $score,
                ...($scores[$key . '_data'] ?? []),
            ];
        }

        usort($fused, fn($a, $b) => $b['score'] <=> $a['score']);

        return array_slice($fused, 0, $limit);
    }
}
```

**RRF 的优势**：不依赖绝对分数，只看排名，对不同检索器的分数尺度差异天然免疫。

---

### Anti-Pattern #7：Query 不做改写，用户口语化表达检索失败

**现象**：用户输入"咋退款"，但文档里写的是"退款申请流程"。纯向量检索可能匹配不到。

**修复方案：Query Rewriting**

```php
class QueryRewriter
{
    private LLMClient $llm;

    public function rewrite(string $originalQuery): array
    {
        // 用 LLM 生成多个查询变体
        $prompt = <<<PROMPT
用户原始查询：{$originalQuery}

请生成 3 个不同角度的查询，用于检索相关文档。要求：
1. 一个保持原意但用正式用语
2. 一个拆解为更具体的子问题
3. 一个从反面或相关概念角度

输出 JSON 数组格式。
PROMPT;

        $response = $this->llm->chat($prompt);
        $variants = json_decode($response, true) ?: [$originalQuery];

        // 加上原始查询
        array_unshift($variants, $originalQuery);

        return array_unique($variants);
    }

    public function rewriteWithHyDE(string $query): string
    {
        // HyDE: 让 LLM 生成一个假设性回答，用回答的 embedding 去检索
        $prompt = <<<PROMPT
请根据以下问题，写一段可能包含答案的文字（不需要准确，只需要相关）：

问题：{$query}
PROMPT;

        return $this->llm->chat($prompt);
    }
}
```

**HyDE（Hypothetical Document Embedding）** 原理：LLM 生成的假设性回答在 embedding 空间里更接近真实文档，比原始短 query 检索效果更好。

---

### Anti-Pattern #8：没有 Reranker，检索精度天花板低

**现象**：向量检索返回 top-10，但真正相关的只有 3 条，其余 7 条噪声会干扰 LLM 判断。

**修复方案：Two-Stage Retrieval（两阶段检索）**

```php
class TwoStageRetriever
{
    private HybridRetriever $retriever;
    private RerankerClient $reranker;

    public function search(string $query, int $finalLimit = 5): array
    {
        // Stage 1: 粗召回，多取一些
        $candidates = $this->retriever->search($query, limit: 30);

        // Stage 2: 精排 Rerank
        $reranked = $this->reranker->rerank(
            query: $query,
            documents: array_map(fn($c) => $c['text'], $candidates),
            topN: $finalLimit
        );

        // 合并元数据
        return array_map(function ($item) use ($candidates) {
            return [
                ...$candidates[$item['index']],
                'rerankScore' => $item['relevance_score'],
            ];
        }, $reranked);
    }
}

// Reranker 通常用 cross-encoder 模型
class RerankerClient
{
    private string $endpoint;

    public function rerank(string $query, array $documents, int $topN): array
    {
        $response = Http::post($this->endpoint . '/rerank', [
            'query' => $query,
            'documents' => $documents,
            'top_n' => $topN,
            'model' => 'bge-reranker-v2-m3',
        ]);

        return $response->json('results');
    }
}
```

**Reranker 的价值**：Cross-encoder 对 query-document pair 做联合编码，比 bi-encoder（embedding 检索）精度高 10-20%，但计算成本高，所以只对 top-30 做精排。

---

## 四、向量漂移（Anti-Pattern #9-#10）

### Anti-Pattern #9：文档更新后 embedding 不同步

**现象**：文档内容改了，但向量数据库里存的还是旧 embedding。用户检索到的是过时信息。

**根因**：缺乏增量同步机制。文档更新 → 需要重新切片 → 重新生成 embedding → 更新向量库。很多系统只做了初始导入，没有持续同步。

**修复方案：基于文档哈希的增量同步**

```php
class DocumentSyncManager
{
    private VectorStore $store;
    private EmbeddingService $embedder;
    private DocumentChunker $chunker;
    private HashStore $hashStore;

    public function syncDocument(string $docId, string $content, array $metadata): void
    {
        // 计算内容哈希
        $currentHash = md5($content);
        $storedHash = $this->hashStore->get($docId);

        if ($currentHash === $storedHash) {
            return; // 内容未变，跳过
        }

        // 删除旧 chunks
        if ($storedHash !== null) {
            $this->store->deleteByFilter(['docId' => $docId]);
        }

        // 重新切片 + embedding
        $chunks = $this->chunker->chunk($content);
        $vectors = [];

        foreach ($chunks as $index => $chunkText) {
            $chunkMeta = new ChunkMetadata(
                docId: $docId,
                docTitle: $metadata['title'],
                section: $this->extractSection($chunkText),
                chunkIndex: $index,
                totalChunks: count($chunks),
                source: $metadata['source'] ?? '',
                updatedAt: date('Y-m-d H:i:s'),
            );

            $vectors[] = [
                'id' => md5($docId . $index),
                'vector' => $this->embedder->embed(
                    $chunkMeta->toEmbeddingPrefix() . $chunkText
                ),
                'text' => $chunkText,
                'metadata' => $chunkMeta->toArray(),
            ];
        }

        // 批量写入
        $this->store->batchUpsert($vectors);

        // 更新哈希
        $this->hashStore->set($docId, $currentHash);
    }

    public function fullSync(string $sourceDir): void
    {
        $files = glob($sourceDir . '/*.md');

        foreach ($files as $file) {
            $docId = basename($file, '.md');
            $content = file_get_contents($file);
            $metadata = $this->extractFrontMatter($content);

            $this->syncDocument($docId, $content, $metadata);
        }

        // 清理已删除文档的向量
        $this->cleanupOrphans($sourceDir);
    }

    private function cleanupOrphans(string $sourceDir): void
    {
        $existingDocs = array_map(
            fn($f) => basename($f, '.md'),
            glob($sourceDir . '/*.md')
        );

        $storedDocs = $this->hashStore->allKeys();
        $orphans = array_diff($storedDocs, $existingDocs);

        foreach ($orphans as $docId) {
            $this->store->deleteByFilter(['docId' => $docId]);
            $this->hashStore->delete($docId);
        }
    }
}
```

**落地建议**：

- 小规模（<1000 文档）：定时全量同步，每小时/每天
- 大规模：监听文件系统事件（inotify/FSEvents）或 Webhook 触发增量同步
- 关键业务：加版本号，支持回滚到历史 embedding

---

### Anti-Pattern #10：Embedding 模型升级后索引全部失效

**现象**：团队升级了 Embedding 模型（比如从 text-embedding-ada-002 换到 text-embedding-3-large），新旧向量维度不同，检索完全混乱。

**根因**：不同模型生成的向量在同一空间里不可比较。升级模型意味着所有已索引的向量都需要重新生成。

**修复方案：Blue-Green 索引切换**

```php
class EmbeddingMigrationManager
{
    private VectorStore $store;
    private EmbeddingService $embedder;
    private ConfigRepository $config;

    public function migrate(string $newModel): void
    {
        // 1. 创建新 collection（Green）
        $greenCollection = 'docs_' . str_replace('-', '_', $newModel) . '_' . time();
        $this->store->createCollection($greenCollection, [
            'dimension' => $this->embedder->getDimension($newModel),
        ]);

        // 2. 从源文档重新生成 embedding
        $sourceDocs = $this->getAllSourceDocuments();
        $batch = [];

        foreach ($sourceDocs as $doc) {
            $chunks = $this->chunker->chunk($doc['content']);

            foreach ($chunks as $index => $chunk) {
                $embedding = $this->embedder->embedWithModel(
                    $chunk,
                    $newModel
                );

                $batch[] = [
                    'id' => md5($doc['id'] . $index),
                    'vector' => $embedding,
                    'text' => $chunk,
                    'metadata' => [
                        'docId' => $doc['id'],
                        'model' => $newModel,
                        'migratedAt' => date('c'),
                    ],
                ];

                // 批量写入，每 100 条一批
                if (count($batch) >= 100) {
                    $this->store->batchUpsert($batch, $greenCollection);
                    $batch = [];
                }
            }
        }

        if (!empty($batch)) {
            $this->store->batchUpsert($batch, $greenCollection);
        }

        // 3. 验证新索引
        $testResults = $this->store->search(
            $this->embedder->embedWithModel('测试查询', $newModel),
            $greenCollection,
            limit: 5
        );

        if (count($testResults) < 3) {
            throw new \RuntimeException('Migration validation failed');
        }

        // 4. 原子切换
        $this->config->set('rag.collection', $greenCollection);

        // 5. 延迟删除旧 collection（保留 7 天回滚窗口）
        $oldCollection = $this->config->get('rag.collection_old');
        if ($oldCollection) {
            $this->scheduleDeletion($oldCollection, days: 7);
        }
        $this->config->set('rag.collection_old', $greenCollection);
    }
}
```

**关键点**：

- 永远不要原地替换索引，用 Blue-Green 部署
- 保留旧索引至少 7 天，方便回滚
- 迁移前做 A/B 测试：新旧模型同时检索，人工评估质量

---

## 五、监控与可观测性

RAG 系统上线后，必须有监控。以下是核心指标：

```php
class RagMetrics
{
    private MetricsClient $metrics;

    public function recordRetrieval(string $query, array $results, float $latencyMs): void
    {
        // 检索质量指标
        $this->metrics->histogram('rag.retrieval.latency_ms', $latencyMs);
        $this->metrics->gauge('rag.retrieval.result_count', count($results));

        // 相关性分布
        $scores = array_column($results, 'score');
        $avgScore = $scores ? array_sum($scores) / count($scores) : 0;
        $this->metrics->histogram('rag.retrieval.avg_relevance', $avgScore);

        // 低相关性告警
        if ($avgScore < 0.5) {
            $this->metrics->increment('rag.retrieval.low_relevance');
            logger()->warning('RAG low relevance', [
                'query' => $query,
                'avg_score' => $avgScore,
            ]);
        }
    }

    public function recordGeneration(string $query, string $answer, array $sources): void
    {
        // 幻觉检测（简化版：检查回答是否引用了来源）
        $hasCitation = false;
        foreach ($sources as $source) {
            if (str_contains($answer, $source['metadata']['docTitle'])) {
                $hasCitation = true;
                break;
            }
        }

        if (!$hasCitation && count($sources) > 0) {
            $this->metrics->increment('rag.generation.no_citation');
        }
    }

    public function recordUserFeedback(string $queryId, bool $helpful): void
    {
        $this->metrics->increment(
            $helpful ? 'rag.feedback.positive' : 'rag.feedback.negative'
        );
    }
}
```

---

## 总结

| Anti-Pattern | 核心问题 | 修复方案 |
|---|---|---|
| #1 固定长度切片 | 语义被切断 | 语义感知切片 + overlap |
| #2 结构噪声 | 目录/页眉污染上下文 | 文档预处理 Pipeline |
| #3 元数据丢失 | 无法溯源 | Chunk 携带完整元数据 |
| #4 不相关结果硬编 | LLM 编造答案 | 相关性阈值 + 兜底策略 |
| #5 幻觉累积 | 多轮对话错误放大 | 对话感知检索 + 历史校验 |
| #6 Embedding 不匹配 | 短 query 检索长文档差 | Hybrid Search + RRF |
| #7 口语化 query | 表达差异检索失败 | Query Rewriting + HyDE |
| #8 无 Reranker | 粗召回噪声大 | Two-Stage Retrieval |
| #9 Embedding 不同步 | 检索到过时信息 | 基于哈希的增量同步 |
| #10 模型升级失效 | 新旧向量不可比 | Blue-Green 索引切换 |

**一句话总结**：RAG 系统的质量上限不在 LLM，在于检索工程。把检索做好，用 7B 模型也能出好结果；检索做烂，用 GPT-4 也救不了。

---

## 参考资料

- [RAG Survey 2025](https://arxiv.org/abs/2312.10997) - RAG 系统综述
- [HyDE Paper](https://arxiv.org/abs/2212.10496) - Hypothetical Document Embeddings
- [RRF Paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) - Reciprocal Rank Fusion
- [BGE Reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3) - 开源 Reranker 模型
