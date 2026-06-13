---
title: AI Agent Feedback Loop 实战：用户隐式反馈驱动的 Agent 自动改进
keywords: [AI Agent Feedback Loop, Agent, 用户隐式反馈驱动的, 自动改进, AI]
date: 2026-06-09 15:15:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - Feedback Loop
  - Laravel
  - 向量聚类
  - 隐式反馈
  - 自动改进
description: 介绍如何通过捕获用户隐式反馈（停留时间、重试次数、编辑行为）构建 AI Agent 的自动改进闭环，使用 Laravel 日志系统 + 向量聚类实现反馈分析和 Prompt 自动优化。
---


## 概述

传统 AI Agent 的改进依赖人工标注和显式评分——用户点了"有用"还是"没用"。但现实是，大多数用户不会主动给出反馈。他们的真实态度藏在行为里：

- **停留时间过短**（<3 秒就关掉）→ 回答大概率没用
- **反复重试同一类问题** → Agent 没理解用户意图
- **用户手动编辑了 Agent 的输出** → 输出有瑕疵但方向对了
- **用户复制了输出但没编辑** → 输出质量达标

这些就是**隐式反馈（Implicit Feedback）**。本文将用 Laravel 实现一套完整的闭环：捕获隐式反馈 → 向量化聚类分析 → 自动调整 Agent Prompt → 效果验证。

## 核心概念

### 为什么隐式反馈比显式反馈更可靠

| 维度 | 显式反馈 | 隐式反馈 |
|------|---------|---------|
| 数据量 | 稀疏（<5% 用户会评分） | 海量（每次交互都有） |
| 真实性 | 可能有偏见（极端评分多） | 行为即真相 |
| 成本 | 需要额外 UI 和打断 | 零感知采集 |
| 延迟 | 用户主动触发 | 实时产生 |

### 反馈信号定义

我们将隐式反馈分为四类信号：

```
1. 停留时间（Dwell Time）
   - < 3秒 → 无用（score: 0.1）
   - 3-10秒 → 浏览（score: 0.3）
   - 10-60秒 → 阅读（score: 0.7）
   - > 60秒 → 深度使用（score: 1.0）

2. 重试行为（Retry）
   - 同一 session 内相似问题重试 → 负反馈
   - 重试次数 / 总交互次数 = 重试率

3. 编辑行为（Edit）
   - 用户修改了 Agent 输出 → 部分正反馈
   - 编辑比例 = 修改字数 / 总字数
   - 编辑比例 < 20% → 微调（score: 0.8）
   - 编辑比例 > 50% → 重写（score: 0.3）

4. 复制行为（Copy）
   - 直接复制无编辑 → 完美正反馈（score: 1.0）
   - 复制后编辑 → 部分正反馈
```

### 闭环架构

```
用户交互 → 行为采集（前端埋点）
    ↓
Laravel 日志存储（结构化事件）
    ↓
定时任务：向量化反馈文本
    ↓
向量聚类：发现模式（哪些类型的回答有问题）
    ↓
Prompt 模板自动调整
    ↓
A/B 验证：新 Prompt vs 旧 Prompt
    ↓
效果达标 → 部署 / 效果回退 → 人工介入
```

## 实战代码

### 1. 数据库设计

首先创建反馈事件表和聚类结果表：

```php
// database/migrations/2026_06_09_create_agent_feedback_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 反馈事件表
        Schema::create('agent_feedback_events', function (Blueprint $table) {
            $table->id();
            $table->uuid('session_id');
            $table->string('user_id', 64)->index();
            $table->string('agent_type', 64)->index(); // 哪个 Agent
            $table->text('user_query');                  // 用户原始问题
            $table->text('agent_response');              // Agent 回复
            $table->string('event_type', 32)->index();   // dwell/retry/edit/copy
            $table->json('event_data')->nullable();      // 详细数据
            $table->float('score', 4, 3);                // 0.000 - 1.000
            $table->vector('embedding', 1536)->nullable(); // 向量
            $table->unsignedBigInteger('cluster_id')->nullable()->index();
            $table->timestamps();

            $table->index(['agent_type', 'event_type']);
            $table->index('created_at');
        });

        // 聚类结果表
        Schema::create('agent_feedback_clusters', function (Blueprint $table) {
            $table->id();
            $table->string('agent_type', 64)->index();
            $table->unsignedInteger('cluster_size');
            $table->float('avg_score', 4, 3);
            $table->vector('centroid', 1536);
            $table->json('representative_queries');  // 代表性问题
            $table->json('common_issues');            // 发现的问题
            $table->text('suggested_prompt_patch')->nullable(); // 建议的 Prompt 修改
            $table->string('status', 20)->default('pending'); // pending/applied/rejected
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_feedback_clusters');
        Schema::dropIfExists('agent_feedback_events');
    }
};
```

### 2. 前端行为采集

在前端埋点，通过 Beacon API 异步上报：

```javascript
// resources/js/agent-feedback-tracker.js

class AgentFeedbackTracker {
    constructor(sessionId, agentType) {
        this.sessionId = sessionId;
        this.agentType = agentType;
        this.pendingEvents = [];
        this.setupBeforeUnload();
    }

    // 追踪停留时间
    trackDwell(messageId, query, response) {
        const startTime = Date.now();

        return {
            end: () => {
                const dwellMs = Date.now() - startTime;
                this.emit('dwell', messageId, query, response, {
                    dwell_ms: dwellMs,
                });
            }
        };
    }

    // 追踪重试
    trackRetry(messageId, query, response, retryCount) {
        this.emit('retry', messageId, query, response, {
            retry_count: retryCount,
        });
    }

    // 追踪编辑行为
    trackEdit(messageId, query, originalResponse, editedResponse) {
        const originalLen = originalResponse.length;
        const editedLen = editedResponse.length;
        // 简单的编辑比例计算（实际可用 diff 算法）
        const editRatio = Math.abs(editedLen - originalLen) / originalLen;

        this.emit('edit', messageId, query, originalResponse, {
            edited_response: editedResponse,
            edit_ratio: editRatio,
        });
    }

    // 追踪复制行为
    trackCopy(messageId, query, response) {
        this.emit('copy', messageId, query, response, {});
    }

    emit(eventType, messageId, query, response, eventData) {
        const payload = {
            session_id: this.sessionId,
            agent_type: this.agentType,
            user_query: query,
            agent_response: response,
            event_type: eventType,
            event_data: eventData,
            timestamp: new Date().toISOString(),
        };

        // 优先用 Beacon API（页面关闭也能发）
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/agent-feedback', JSON.stringify(payload));
        } else {
            fetch('/api/agent-feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true,
            });
        }
    }

    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            // 批量发送未上报的事件
            if (this.pendingEvents.length > 0) {
                navigator.sendBeacon(
                    '/api/agent-feedback/batch',
                    JSON.stringify(this.pendingEvents)
                );
            }
        });
    }
}

// 使用示例
const tracker = new AgentFeedbackTracker('sess_abc123', 'customer-service');

// Agent 回复后，开始追踪停留
const dwellTracker = tracker.trackDwell('msg_001', '如何退款？', '请进入订单页面...');
// 用户离开回复区域时结束追踪
document.getElementById('msg_001').addEventListener('mouseleave', () => {
    dwellTracker.end();
});
```

### 3. Laravel 后端接收

```php
// app/Http/Controllers/AgentFeedbackController.php

namespace App\Http\Controllers;

use App\Services\AgentFeedback\FeedbackScorer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AgentFeedbackController extends Controller
{
    public function store(Request $request, FeedbackScorer $scorer)
    {
        $validated = $request->validate([
            'session_id'      => 'required|string',
            'agent_type'      => 'required|string|max:64',
            'user_query'      => 'required|string',
            'agent_response'  => 'required|string',
            'event_type'      => 'required|in:dwell,retry,edit,copy',
            'event_data'      => 'nullable|array',
        ]);

        $score = $scorer->calculate(
            $validated['event_type'],
            $validated['event_data'] ?? []
        );

        DB::table('agent_feedback_events')->insert([
            'session_id'     => $validated['session_id'],
            'user_id'        => $request->user()?->id ?? 'anonymous',
            'agent_type'     => $validated['agent_type'],
            'user_query'     => $validated['user_query'],
            'agent_response' => $validated['agent_response'],
            'event_type'     => $validated['event_type'],
            'event_data'     => json_encode($validated['event_data'] ?? []),
            'score'          => $score,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        return response()->json(['status' => 'ok', 'score' => $score]);
    }

    public function batch(Request $request, FeedbackScorer $scorer)
    {
        $events = $request->validate([
            '*.session_id'     => 'required|string',
            '*.agent_type'     => 'required|string|max:64',
            '*.user_query'     => 'required|string',
            '*.agent_response' => 'required|string',
            '*.event_type'     => 'required|in:dwell,retry,edit,copy',
            '*.event_data'     => 'nullable|array',
        ]);

        $records = array_map(function ($event) use ($scorer) {
            return [
                'session_id'     => $event['session_id'],
                'user_id'        => 'anonymous',
                'agent_type'     => $event['agent_type'],
                'user_query'     => $event['user_query'],
                'agent_response' => $event['agent_response'],
                'event_type'     => $event['event_type'],
                'event_data'     => json_encode($event['event_data'] ?? []),
                'score'          => $scorer->calculate($event['event_type'], $event['event_data'] ?? []),
                'created_at'     => now(),
                'updated_at'     => now(),
            ];
        }, $events);

        DB::table('agent_feedback_events')->insert($records);

        return response()->json(['status' => 'ok', 'count' => count($records)]);
    }
}
```

### 4. 评分服务

```php
// app/Services/AgentFeedback/FeedbackScorer.php

namespace App\Services\AgentFeedback;

class FeedbackScorer
{
    /**
     * 根据事件类型和数据计算反馈分数
     */
    public function calculate(string $eventType, array $data): float
    {
        return match ($eventType) {
            'dwell'  => $this->scoreDwell($data['dwell_ms'] ?? 0),
            'retry'  => $this->scoreRetry($data['retry_count'] ?? 1),
            'edit'   => $this->scoreEdit($data['edit_ratio'] ?? 0),
            'copy'   => 1.0, // 直接复制 = 完美
            default  => 0.5,
        };
    }

    private function scoreDwell(int $dwellMs): float
    {
        $seconds = $dwellMs / 1000;

        return match (true) {
            $seconds < 3   => 0.1,  // 秒关 = 没用
            $seconds < 10  => 0.3,  // 扫了一眼
            $seconds < 60  => 0.7,  // 认真看了
            default        => 1.0,  // 深度使用
        };
    }

    private function scoreRetry(int $retryCount): float
    {
        return match (true) {
            $retryCount <= 1 => 0.5,  // 第一次没理解，重试一次正常
            $retryCount <= 3 => 0.2,  // 多次重试 = 严重问题
            default          => 0.1,  // 反复重试 = 完全失败
        };
    }

    private function scoreEdit(float $editRatio): float
    {
        return match (true) {
            $editRatio < 0.1  => 1.0,  // 几乎没改 = 完美
            $editRatio < 0.2  => 0.8,  // 小修 = 微调
            $editRatio < 0.5  => 0.5,  // 改了一半 = 方向对但不准
            default           => 0.2,  // 基本重写 = 方向错误
        };
    }
}
```

### 5. 向量化 + 聚类分析（核心）

这是整个闭环的关键环节：将反馈文本向量化，然后用聚类发现"哪类问题的 Agent 回答质量差"。

```php
// app/Services/AgentFeedback/FeedbackClusterer.php

namespace App\Services\AgentFeedback;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FeedbackClusterer
{
    private string $embeddingModel = 'text-embedding-3-small';
    private string $embeddingEndpoint;

    public function __construct()
    {
        $this->embeddingEndpoint = config('services.openai.embeddings_url',
            'https://api.openai.com/v1/embeddings'
        );
    }

    /**
     * 主流程：向量化未处理的反馈 → 聚类 → 生成改进建议
     */
    public function run(string $agentType, int $batchSize = 200): array
    {
        // 1. 拉取未向量化的反馈
        $events = DB::table('agent_feedback_events')
            ->where('agent_type', $agentType)
            ->whereNull('embedding')
            ->orderBy('created_at')
            ->limit($batchSize)
            ->get();

        if ($events->isEmpty()) {
            return ['processed' => 0, 'clusters' => 0];
        }

        Log::info("FeedbackClusterer: processing {$events->count()} events for {$agentType}");

        // 2. 批量向量化
        $this->batchEmbed($events);

        // 3. DBSCAN 聚类（在内存中处理，适合万级数据）
        $clusters = $this->dbscan($agentType, eps: 0.3, minSamples: 5);

        // 4. 对每个聚类生成改进建议
        $suggestions = [];
        foreach ($clusters as $clusterId => $members) {
            $suggestion = $this->generateSuggestion($agentType, $clusterId, $members);
            if ($suggestion) {
                $suggestions[] = $suggestion;
            }
        }

        return [
            'processed'  => $events->count(),
            'clusters'   => count($clusters),
            'suggestions' => $suggestions,
        ];
    }

    /**
     * 批量向量化
     */
    private function batchEmbed($events): void
    {
        $texts = $events->map(fn($e) => "Q: {$e->user_query}\nA: {$e->agent_response}")->toArray();

        // 分批调用 embedding API（每次最多 100 条）
        foreach (array_chunk($texts, 100) as $chunk) {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                'Content-Type'  => 'application/json',
            ])->timeout(60)->post($this->embeddingEndpoint, [
                'model' => $this->embeddingModel,
                'input' => $chunk,
            ]);

            if ($response->failed()) {
                Log::error('Embedding API failed', ['status' => $response->status()]);
                continue;
            }

            $embeddings = $response->json('data');
            foreach ($embeddings as $i => $item) {
                $eventIndex = array_search($item['index'] ?? $i, range(0, count($chunk) - 1));
                if ($eventIndex !== false && isset($events[$eventIndex])) {
                    DB::table('agent_feedback_events')
                        ->where('id', $events[$eventIndex]->id)
                        ->update(['embedding' => json_encode($item['embedding'])]);
                }
            }
        }
    }

    /**
     * 简易 DBSCAN 聚类（生产环境建议用 pgvector 的 <-> 算子）
     */
    private function dbscan(string $agentType, float $eps, int $minSamples): array
    {
        $events = DB::table('agent_feedback_events')
            ->where('agent_type', $agentType)
            ->whereNotNull('embedding')
            ->whereNull('cluster_id')
            ->orderBy('created_at', 'desc')
            ->limit(5000)
            ->get();

        $vectors = [];
        $ids = [];
        foreach ($events as $e) {
            $vectors[] = json_decode($e->embedding, true);
            $ids[] = $e->id;
        }

        $n = count($vectors);
        $labels = array_fill(0, $n, -1); // -1 = noise
        $clusterId = 0;

        for ($i = 0; $i < $n; $i++) {
            if ($labels[$i] !== -1) continue;

            $neighbors = $this->rangeQuery($vectors, $i, $eps);
            if (count($neighbors) < $minSamples) continue;

            $labels[$i] = $clusterId;
            $seeds = $neighbors;

            for ($j = 0; $j < count($seeds); $j++) {
                $q = $seeds[$j];
                if ($labels[$q] === -1) {
                    $labels[$q] = $clusterId;
                }
                if ($labels[$q] !== -1) continue;

                $labels[$q] = $clusterId;
                $newNeighbors = $this->rangeQuery($vectors, $q, $eps);
                if (count($newNeighbors) >= $minSamples) {
                    $seeds = array_merge($seeds, $newNeighbors);
                }
            }

            $clusterId++;
        }

        // 写入聚类结果
        $clusters = [];
        for ($i = 0; $i < $n; $i++) {
            if ($labels[$i] >= 0) {
                $clusters[$labels[$i]][] = $ids[$i];
                DB::table('agent_feedback_events')
                    ->where('id', $ids[$i])
                    ->update(['cluster_id' => $labels[$i]]);
            }
        }

        return $clusters;
    }

    private function rangeQuery(array $vectors, int $targetIdx, float $eps): array
    {
        $neighbors = [];
        for ($i = 0; $i < count($vectors); $i++) {
            if ($this->cosineSimilarity($vectors[$targetIdx], $vectors[$i]) >= (1 - $eps)) {
                $neighbors[] = $i;
            }
        }
        return $neighbors;
    }

    private function cosineSimilarity(array $a, array $b): float
    {
        $dot = $normA = $normB = 0;
        for ($i = 0, $len = count($a); $i < $len; $i++) {
            $dot += $a[$i] * $b[$i];
            $normA += $a[$i] ** 2;
            $normB += $b[$i] ** 2;
        }
        return $dot / (sqrt($normA) * sqrt($normB) + 1e-10);
    }

    /**
     * 用 LLM 分析聚类，生成 Prompt 改进建议
     */
    private function generateSuggestion(string $agentType, int $clusterId, array $memberIds): ?array
    {
        $samples = DB::table('agent_feedback_events')
            ->whereIn('id', $memberIds)
            ->orderBy('score', 'asc') // 优先看低分的
            ->limit(10)
            ->get(['user_query', 'agent_response', 'score', 'event_type']);

        $avgScore = $samples->avg('score');
        if ($avgScore >= 0.7) {
            return null; // 质量已经不错，跳过
        }

        $sampleText = $samples->map(fn($s) =>
            "问题: {$s->user_query}\n回复: {$s->agent_response}\n分数: {$s->score} ({$s->event_type})"
        )->join("\n---\n");

        // 调用 LLM 分析问题并生成改进建议
        $response = \Illuminate\Support\Facades\Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
            'Content-Type'  => 'application/json',
        ])->timeout(120)->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4o',
            'messages' => [
                ['role' => 'system', 'content' => <<<PROMPT
你是一个 AI Agent 优化专家。分析以下反馈聚类中的低质量回复，找出共性问题，并给出具体的 Prompt 改进建议。

要求：
1. 指出共性问题是什么（如：回复太长、不够具体、理解错误等）
2. 给出一段可以追加到 System Prompt 中的改进建段落（中文）
3. 给出一个"反面示例"（当前的差回复）和"正面示例"（改进后应该的样子）
PROMPT],
                ['role' => 'user', 'content' => "Agent 类型: {$agentType}\n聚类 ID: {$clusterId}\n平均分数: {$avgScore}\n\n样本:\n{$sampleText}"],
            ],
        ]);

        if ($response->failed()) {
            Log::error('Suggestion generation failed', ['cluster' => $clusterId]);
            return null;
        }

        $analysis = $response->json('choices.0.message.content');

        // 存入聚类结果表
        DB::table('agent_feedback_clusters')->insert([
            'agent_type'            => $agentType,
            'cluster_size'          => count($memberIds),
            'avg_score'             => round($avgScore, 3),
            'centroid'              => json_encode([0]), // 简化
            'representative_queries' => json_encode($samples->pluck('user_query')->take(5)->toArray()),
            'common_issues'         => json_encode(['auto_analyzed']),
            'suggested_prompt_patch' => $analysis,
            'status'                => 'pending',
            'created_at'            => now(),
            'updated_at'            => now(),
        ]);

        return [
            'cluster_id'  => $clusterId,
            'avg_score'   => $avgScore,
            'sample_count' => count($memberIds),
            'suggestion'  => $analysis,
        ];
    }
}
```

### 6. 定时任务调度

```php
// app/Console/Commands/AnalyzeAgentFeedback.php

namespace App\Console\Commands;

use App\Services\AgentFeedback\FeedbackClusterer;
use Illuminate\Console\Command;

class AnalyzeAgentFeedback extends Command
{
    protected $signature = 'agent:analyze-feedback {--agent=customer-service : Agent 类型}';
    protected $description = '分析 Agent 反馈并生成改进建议';

    public function handle(FeedbackClusterer $clusterer): int
    {
        $agentType = $this->option('agent');

        $this->info("正在分析 {$agentType} 的反馈数据...");

        $result = $clusterer->run($agentType);

        $this->info("处理了 {$result['processed']} 条反馈");
        $this->info("发现 {$result['clusters']} 个聚类");

        if (!empty($result['suggestions'])) {
            $this->newLine();
            $this->info('=== 改进建议 ===');
            foreach ($result['suggestions'] as $s) {
                $this->warn("聚类 #{$s['cluster_id']} (平均分: {$s['avg_score']}, 样本数: {$s['sample_count']})");
                $this->line($s['suggestion']);
                $this->newLine();
            }
        }

        return self::SUCCESS;
    }
}
```

```php
// app/Console/Kernel.php 中注册

protected function schedule(Schedule $schedule): void
{
    // 每天凌晨 2 点分析反馈
    $schedule->command('agent:analyze-feedback --agent=customer-service')
        ->dailyAt('02:00')
        ->withoutOverlapping();

    $schedule->command('agent:analyze-feedback --agent=code-assistant')
        ->dailyAt('02:30')
        ->withoutOverlapping();
}
```

### 7. Prompt 自动应用（带 A/B 验证）

```php
// app/Services/AgentFeedback/PromptApplier.php

namespace App\Services\AgentFeedback;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class PromptApplier
{
    /**
     * 应用通过审核的 Prompt 补丁
     */
    public function apply(int $clusterId, string $agentType): bool
    {
        $cluster = DB::table('agent_feedback_clusters')
            ->where('id', $clusterId)
            ->where('status', 'pending')
            ->first();

        if (!$cluster) {
            return false;
        }

        // 读取当前 Prompt 模板
        $currentPrompt = $this->loadPrompt($agentType);

        // 追加改进段落
        $patch = $cluster->suggested_prompt_patch;
        $newPrompt = $currentPrompt . "\n\n## 自动优化（基于用户反馈）\n" . $patch;

        // 存入 A/B 测试配置
        $abKey = "agent_prompt_ab:{$agentType}";
        Cache::put($abKey, [
            'control'  => $currentPrompt,
            'treatment' => $newPrompt,
            'started_at' => now()->toISOString(),
            'cluster_id' => $clusterId,
        ], now()->addDays(7));

        // 更新状态
        DB::table('agent_feedback_clusters')
            ->where('id', $clusterId)
            ->update(['status' => 'applied']);

        return true;
    }

    /**
     * A/B 分流：根据 session ID 决定用哪个 Prompt
     */
    public function getPrompt(string $agentType, string $sessionId): string
    {
        $abKey = "agent_prompt_ab:{$agentType}";
        $ab = Cache::get($abKey);

        if (!$ab) {
            return $this->loadPrompt($agentType);
        }

        // 50/50 分流（基于 session hash）
        $useTreatment = (crc32($sessionId) % 100) < 50;

        return $useTreatment ? $ab['treatment'] : $ab['control'];
    }

    private function loadPrompt(string $agentType): string
    {
        $path = resource_path("prompts/{$agentType}.md");
        return file_exists($path) ? file_get_contents($path) : 'You are a helpful assistant.';
    }
}
```

## 踩坑记录

### 踩坑 1：Dwell Time 不等于质量

用户在手机端停留时间普遍偏短（屏幕小，扫一眼就走）。解决方案：**按设备类型做归一化**。

```php
private function scoreDwell(int $dwellMs, string $deviceType = 'desktop'): float
{
    $seconds = $dwellMs / 1000;

    // 移动端的阈值降低
    $multiplier = match ($deviceType) {
        'mobile'  => 0.6,
        'tablet'  => 0.8,
        default   => 1.0,
    };

    $adjustedSeconds = $seconds / $multiplier;

    return match (true) {
        $adjustedSeconds < 3   => 0.1,
        $adjustedSeconds < 10  => 0.3,
        $adjustedSeconds < 60  => 0.7,
        default                => 1.0,
    };
}
```

### 踩坑 2：Embedding 费用爆炸

每天几千条反馈，每条都要向量化，一个月下来费用不小。解决方案：

1. **去重**：相同 query + response 只向量化一次
2. **降采样**：低分反馈全量处理，高分反馈只采样 10%
3. **本地小模型**：用 `all-MiniLM-L6-v2`（免费）处理英文，API 只处理中文

```php
private function shouldEmbed(string $queryHash, float $score): bool
{
    // 已向量化过，跳过
    if (Cache::has("embed:{$queryHash}")) {
        return false;
    }

    // 低分全量，高分 10% 采样
    if ($score >= 0.7) {
        return random_int(1, 10) === 1;
    }

    return true;
}
```

### 踩坑 3：DBSCAN 的 eps 参数敏感

eps 太小 → 聚类太多，每个只有几条；eps 太大 → 所有反馈混成一坨。建议用**轮廓系数（Silhouette Score）**自动调参：

```php
private function findBestEps(array $vectors, int $minSamples): float
{
    $bestEps = 0.3;
    $bestScore = -1;

    foreach ([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5] as $eps) {
        $labels = $this->dbscanWithParams($vectors, $eps, $minSamples);
        $score = $this->silhouetteScore($vectors, $labels);

        if ($score > $bestScore) {
            $bestScore = $score;
            $bestEps = $eps;
        }
    }

    return $bestEps;
}
```

### 踩坑 4：用户编辑行为的采集时机

在 textarea 里追踪编辑很 tricky——用户可能改了一个字就复制走了，也可能改了很多又全部撤销。解决方案：用 `MutationObserver` + debounce，只在用户"确认"（复制、发送、离开）时才上报最终编辑结果。

## 总结

这套 Feedback Loop 的核心思路是**让用户的行为替用户说话**，而不是逼用户填评分表。关键点：

1. **采集层**：前端 Beacon API + 零感知埋点，不影响用户体验
2. **评分层**：四维信号（停留/重试/编辑/复制）加权计算，不同设备类型归一化
3. **分析层**：向量聚类发现"哪类问题质量差"，而不是逐条处理
4. **改进层**：LLM 自动生成 Prompt 补丁，A/B 验证后再全量部署
5. **验证层**：持续监控新旧 Prompt 的平均反馈分数，自动回退低效改进

整套系统在 Laravel 中实现，核心依赖：
- MySQL 8.0+（向量字段可选 pgvector 替代）
- OpenAI Embedding API（或本地 sentence-transformers）
- Laravel Scheduler + Cache

当你的 Agent 日均交互量超过 1000 次时，这套系统能帮你从数据中自动发现改进方向，而不是靠"感觉 Prompt 不太行"来盲目调参。
