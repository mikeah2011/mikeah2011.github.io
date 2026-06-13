---
title: AI Agent Resume/Checkpoint 实战：长时间运行 Agent 的断点恢复——状态快照 + 上下文重建 + 人机审批恢复点
keywords: [AI Agent Resume, Checkpoint, Agent, 长时间运行, 的断点恢复, 状态快照, 上下文重建, 人机审批恢复点, AI]
date: 2026-06-09 17:30:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - 断点恢复
  - Checkpoint
  - Laravel
  - 长时间任务
  - 状态快照
description: 深入实战 AI Agent 的断点恢复机制：如何在长时间运行的 Agent 工作流中实现状态快照、上下文重建、人机审批恢复点，以及基于 Laravel 的完整实现方案。
---


## 概述

AI Agent 不再是"一问一答"的玩具。在生产环境中，一个 Agent 可能需要执行跨越数小时甚至数天的复杂工作流：调研 → 分析 → 写代码 → 测试 → 部署 → 人工审批 → 继续。任何环节出错、服务器重启、Token 耗尽，都需要从断点恢复，而不是从头重来。

这就是 **Resume/Checkpoint 机制**要解决的核心问题。

本文将基于 Laravel 项目实战，完整实现一套 Agent 断点恢复系统，覆盖：

1. **状态快照**：如何序列化 Agent 的完整工作状态
2. **上下文重建**：如何从快照恢复 Agent 的"记忆"
3. **人机审批恢复点**：在关键节点暂停等待人类确认
4. **错误恢复**：超时、崩溃、Token 超限的自动重试

---

## 核心概念

### 什么是 Agent Checkpoint？

Checkpoint 本质上是 Agent 执行过程中某一时刻的**完整状态快照**。类比数据库事务的 WAL（Write-Ahead Log），Agent 在每次重要步骤前后都写入 Checkpoint，确保可以从任意已保存的状态恢复。

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Step 1    │────▶│ Checkpoint  │────▶│   Step 2    │────▶│ Checkpoint  │
│   调研       │     │    CKPT-1   │     │   分析       │     │    CKPT-2   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                         崩溃/重启
                                              │
                                              ▼
                                        恢复到 CKPT-1
                                        继续 Step 2
```

### Checkpoint 与传统消息历史的区别

| 维度 | 消息历史 | Checkpoint |
|------|----------|------------|
| 粒度 | 每条消息 | 每个逻辑步骤 |
| 内容 | LLM 对话 | 完整状态（工具结果、变量、计划） |
| 恢复方式 | 重放消息 | 反序列化状态直接恢复 |
| Token 消耗 | 每次都带历史 | 仅加载最新 Checkpoint |
| 支持分支 | 困难 | 天然支持（多版本 Checkpoint） |

### Checkpoint 的核心数据结构

一个完整的 Checkpoint 应包含：

- **metadata**：ID、时间戳、步骤编号、父 Checkpoint ID
- **agent_state**：当前计划、已完成步骤、待执行步骤
- **messages**：对话历史（用于上下文重建）
- **tool_results**：工具调用结果缓存
- **variables**：Agent 运行时变量（中间结果）
- **human_approval**：审批状态和审批记录

---

## 实战代码

### 1. 数据库设计

```php
<?php

// database/migrations/2026_06_09_000001_create_agent_checkpoints_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agent_checkpoints', function (Blueprint $table) {
            $table->id();
            $table->string('checkpoint_id')->unique();          // UUID
            $table->string('session_id')->index();              // Agent 会话 ID
            $table->string('workflow_id');                      // 工作流 ID
            $table->unsignedBigInteger('step_number');          // 步骤编号
            $table->string('step_name');                        // 步骤名称
            $table->string('status')->default('active');        // active|completed|failed|archived
            
            // 状态快照
            $table->json('agent_state');                        // Agent 当前状态
            $table->json('messages');                           // 对话历史
            $table->json('tool_results')->nullable();           // 工具调用结果
            $table->json('variables')->nullable();              // 运行时变量
            
            // 审批相关
            $table->boolean('requires_approval')->default(false);
            $table->string('approval_status')->default('none'); // none|pending|approved|rejected
            $table->text('approval_note')->nullable();
            $table->timestamp('approved_at')->nullable();
            
            // 元数据
            $table->unsignedInteger('token_count')->default(0);
            $table->unsignedInteger('duration_ms')->default(0);
            $table->string('parent_checkpoint_id')->nullable(); // 父 Checkpoint
            $table->timestamps();
            
            $table->index(['session_id', 'step_number']);
            $table->index(['session_id', 'status']);
        });
    }
};
```

### 2. Checkpoint 模型

```php
<?php

// app/Models/AgentCheckpoint.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class AgentCheckpoint extends Model
{
    protected $fillable = [
        'checkpoint_id',
        'session_id',
        'workflow_id',
        'step_number',
        'step_name',
        'status',
        'agent_state',
        'messages',
        'tool_results',
        'variables',
        'requires_approval',
        'approval_status',
        'approval_note',
        'approved_at',
        'token_count',
        'duration_ms',
        'parent_checkpoint_id',
    ];

    protected function casts(): array
    {
        return [
            'agent_state' => 'array',
            'messages' => 'array',
            'tool_results' => 'array',
            'variables' => 'array',
            'requires_approval' => 'boolean',
            'approved_at' => 'datetime',
            'token_count' => 'integer',
            'duration_ms' => 'integer',
        ];
    }

    public static function boot(): void
    {
        static::creating(function (self $model) {
            $model->checkpoint_id = $model->checkpoint_id ?: Str::uuid()->toString();
        });
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_checkpoint_id', 'checkpoint_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_checkpoint_id', 'checkpoint_id');
    }

    public function scopeForSession($query, string $sessionId)
    {
        return $query->where('session_id', $sessionId);
    }

    public function scopeLatest($query)
    {
        return $query->orderByDesc('step_number');
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function isPendingApproval(): bool
    {
        return $this->requires_approval && $this->approval_status === 'pending';
    }
}
```

### 3. Checkpoint 管理器（核心）

```php
<?php

// app/Services/AgentCheckpointManager.php

namespace App\Services;

use App\Models\AgentCheckpoint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AgentCheckpointManager
{
    public function __construct(
        private readonly AgentStateSerializer $serializer,
    ) {}

    /**
     * 创建 Checkpoint（状态快照）
     */
    public function save(
        string $sessionId,
        string $workflowId,
        int $stepNumber,
        string $stepName,
        array $agentState,
        array $messages,
        ?array $toolResults = null,
        ?array $variables = null,
        int $tokenCount = 0,
        int $durationMs = 0,
    ): AgentCheckpoint {
        // 自动归档旧的 active checkpoint
        $this->archiveActiveCheckpoint($sessionId);

        $checkpoint = AgentCheckpoint::create([
            'checkpoint_id' => Str::uuid()->toString(),
            'session_id' => $sessionId,
            'workflow_id' => $workflowId,
            'step_number' => $stepNumber,
            'step_name' => $stepName,
            'status' => 'active',
            'agent_state' => $this->serializer->serialize($agentState),
            'messages' => $messages,
            'tool_results' => $toolResults,
            'variables' => $variables,
            'token_count' => $tokenCount,
            'duration_ms' => $durationMs,
            'parent_checkpoint_id' => $this->getParentCheckpointId($sessionId),
        ]);

        Log::info('Agent checkpoint saved', [
            'checkpoint_id' => $checkpoint->checkpoint_id,
            'session_id' => $sessionId,
            'step' => $stepNumber,
            'step_name' => $stepName,
        ]);

        return $checkpoint;
    }

    /**
     * 从最近的 Checkpoint 恢复
     */
    public function resume(string $sessionId): ?array
    {
        $checkpoint = AgentCheckpoint::forSession($sessionId)
            ->latest()
            ->first();

        if (!$checkpoint) {
            Log::warning('No checkpoint found for session', ['session_id' => $sessionId]);
            return null;
        }

        // 检查是否在等待审批
        if ($checkpoint->isPendingApproval()) {
            return [
                'status' => 'waiting_approval',
                'checkpoint_id' => $checkpoint->checkpoint_id,
                'step_name' => $checkpoint->step_name,
                'message' => '此步骤等待人工审批',
            ];
        }

        // 标记为恢复中
        $checkpoint->update(['status' => 'active']);

        return [
            'status' => 'resumed',
            'checkpoint_id' => $checkpoint->checkpoint_id,
            'session_id' => $sessionId,
            'workflow_id' => $checkpoint->workflow_id,
            'step_number' => $checkpoint->step_number,
            'step_name' => $checkpoint->step_name,
            'agent_state' => $this->serializer->deserialize($checkpoint->agent_state),
            'messages' => $checkpoint->messages,
            'tool_results' => $checkpoint->tool_results,
            'variables' => $checkpoint->variables,
        ];
    }

    /**
     * 创建人机审批恢复点
     */
    public function saveApprovalPoint(
        string $sessionId,
        string $workflowId,
        int $stepNumber,
        string $stepName,
        array $agentState,
        array $messages,
        string $approvalPrompt,
        ?array $variables = null,
    ): AgentCheckpoint {
        $this->archiveActiveCheckpoint($sessionId);

        return AgentCheckpoint::create([
            'checkpoint_id' => Str::uuid()->toString(),
            'session_id' => $sessionId,
            'workflow_id' => $workflowId,
            'step_number' => $stepNumber,
            'step_name' => $stepName,
            'status' => 'active',
            'agent_state' => $this->serializer->serialize($agentState),
            'messages' => array_merge($messages, [
                [
                    'role' => 'system',
                    'content' => "⏸️ 暂停等待人工审批：{$approvalPrompt}",
                ],
            ]),
            'variables' => $variables,
            'requires_approval' => true,
            'approval_status' => 'pending',
        ]);
    }

    /**
     * 处理审批结果
     */
    public function handleApproval(
        string $checkpointId,
        bool $approved,
        ?string $note = null,
    ): AgentCheckpoint {
        $checkpoint = AgentCheckpoint::findOrFail($checkpointId);

        if (!$checkpoint->isPendingApproval()) {
            throw new \RuntimeException("Checkpoint {$checkpointId} is not pending approval");
        }

        $checkpoint->update([
            'approval_status' => $approved ? 'approved' : 'rejected',
            'approval_note' => $note,
            'approved_at' => now(),
            'status' => $approved ? 'active' : 'failed',
        ]);

        Log::info('Agent checkpoint approval handled', [
            'checkpoint_id' => $checkpointId,
            'approved' => $approved,
        ]);

        return $checkpoint->fresh();
    }

    /**
     * 获取 Checkpoint 分支树（用于调试）
     */
    public function getBranchTree(string $sessionId): array
    {
        $checkpoints = AgentCheckpoint::forSession($sessionId)
            ->orderBy('step_number')
            ->get();

        return $checkpoints->map(fn($cp) => [
            'id' => $cp->checkpoint_id,
            'step' => $cp->step_number,
            'name' => $cp->step_name,
            'status' => $cp->status,
            'parent' => $cp->parent_checkpoint_id,
        ])->toArray();
    }

    private function archiveActiveCheckpoint(string $sessionId): void
    {
        AgentCheckpoint::forSession($sessionId)
            ->where('status', 'active')
            ->update(['status' => 'completed']);
    }

    private function getParentCheckpointId(string $sessionId): ?string
    {
        $last = AgentCheckpoint::forSession($sessionId)
            ->latest()
            ->first();

        return $last?->checkpoint_id;
    }
}
```

### 4. 状态序列化器

```php
<?php

// app/Services/AgentStateSerializer.php

namespace App\Services;

class AgentStateSerializer
{
    /**
     * 序列化 Agent 状态为可存储格式
     */
    public function serialize(array $state): array
    {
        return [
            'current_plan' => $state['current_plan'] ?? null,
            'completed_steps' => $state['completed_steps'] ?? [],
            'pending_steps' => $state['pending_steps'] ?? [],
            'context' => $state['context'] ?? [],
            'error_log' => $state['error_log'] ?? [],
            'retry_count' => $state['retry_count'] ?? 0,
            'max_retries' => $state['max_retries'] ?? 3,
            'serialized_at' => now()->toIso8601String(),
        ];
    }

    /**
     * 反序列化恢复 Agent 状态
     */
    public function deserialize(array $data): array
    {
        return [
            'current_plan' => $data['current_plan'] ?? null,
            'completed_steps' => $data['completed_steps'] ?? [],
            'pending_steps' => $data['pending_steps'] ?? [],
            'context' => $data['context'] ?? [],
            'error_log' => $data['error_log'] ?? [],
            'retry_count' => $data['retry_count'] ?? 0,
            'max_retries' => $data['max_retries'] ?? 3,
        ];
    }
}
```

### 5. Agent 工作流引擎（集成 Checkpoint）

```php
<?php

// app/Services/AgentWorkflowEngine.php

namespace App\Services;

use App\Models\AgentCheckpoint;
use Illuminate\Support\Facades\Log;
use Throwable;

class AgentWorkflowEngine
{
    public function __construct(
        private readonly AgentCheckpointManager $checkpointManager,
        private readonly LlmClient $llm,
    ) {}

    /**
     * 执行 Agent 工作流（支持断点恢复）
     */
    public function execute(
        string $sessionId,
        string $workflowId,
        array $steps,
        ?array $resumeFrom = null,
    ): array {
        $startStep = 0;
        $messages = [];
        $variables = [];
        $agentState = [
            'current_plan' => $steps,
            'completed_steps' => [],
            'pending_steps' => $steps,
        ];

        // 断点恢复
        if ($resumeFrom && $resumeFrom['status'] === 'resumed') {
            $startStep = $resumeFrom['step_number'] + 1;
            $messages = $resumeFrom['messages'];
            $variables = $resumeFrom['variables'] ?? [];
            $agentState = $resumeFrom['agent_state'];

            Log::info('Resuming agent workflow', [
                'session_id' => $sessionId,
                'resume_from_step' => $startStep,
                'checkpoint_id' => $resumeFrom['checkpoint_id'],
            ]);
        }

        $totalSteps = count($steps);

        for ($i = $startStep; $i < $totalSteps; $i++) {
            $step = $steps[$i];
            $stepStart = microtime(true);

            try {
                Log::info('Executing agent step', [
                    'session_id' => $sessionId,
                    'step' => $i,
                    'step_name' => $step['name'],
                ]);

                // 检查是否需要人工审批
                if ($step['requires_approval'] ?? false) {
                    $this->checkpointManager->saveApprovalPoint(
                        sessionId: $sessionId,
                        workflowId: $workflowId,
                        stepNumber: $i,
                        stepName: $step['name'],
                        agentState: $agentState,
                        messages: $messages,
                        approvalPrompt: $step['approval_prompt'] ?? '请审批此步骤',
                        variables: $variables,
                    );

                    return [
                        'status' => 'waiting_approval',
                        'step' => $i,
                        'step_name' => $step['name'],
                    ];
                }

                // 执行步骤
                $result = $this->executeStep($step, $messages, $variables);

                $messages[] = [
                    'role' => 'assistant',
                    'content' => $result['response'],
                ];

                if (isset($result['variables'])) {
                    $variables = array_merge($variables, $result['variables']);
                }

                // 更新状态
                $agentState['completed_steps'][] = $step['name'];
                $agentState['pending_steps'] = array_values(
                    array_diff($agentState['pending_steps'], [$step['name']])
                );

                // 保存 Checkpoint
                $duration = (int) ((microtime(true) - $stepStart) * 1000);
                $this->checkpointManager->save(
                    sessionId: $sessionId,
                    workflowId: $workflowId,
                    stepNumber: $i,
                    stepName: $step['name'],
                    agentState: $agentState,
                    messages: $messages,
                    variables: $variables,
                    tokenCount: $result['token_count'] ?? 0,
                    durationMs: $duration,
                );

            } catch (Throwable $e) {
                Log::error('Agent step failed', [
                    'session_id' => $sessionId,
                    'step' => $i,
                    'error' => $e->getMessage(),
                ]);

                $agentState['error_log'][] = [
                    'step' => $i,
                    'error' => $e->getMessage(),
                    'timestamp' => now()->toIso8601String(),
                ];

                // 检查重试
                if (($agentState['retry_count'] ?? 0) < ($agentState['max_retries'] ?? 3)) {
                    $agentState['retry_count'] = ($agentState['retry_count'] ?? 0) + 1;
                    $i--; // 重试当前步骤
                    continue;
                }

                // 超过重试次数，保存失败 Checkpoint
                $this->checkpointManager->save(
                    sessionId: $sessionId,
                    workflowId: $workflowId,
                    stepNumber: $i,
                    stepName: $step['name'],
                    agentState: $agentState,
                    messages: $messages,
                    variables: $variables,
                );

                return [
                    'status' => 'failed',
                    'step' => $i,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return [
            'status' => 'completed',
            'messages' => $messages,
            'variables' => $variables,
        ];
    }

    private function executeStep(
        array $step,
        array &$messages,
        array &$variables,
    ): array {
        // 构建 prompt
        $prompt = $this->buildStepPrompt($step, $variables);

        $messages[] = [
            'role' => 'user',
            'content' => $prompt,
        ];

        // 调用 LLM
        $response = $this->llm->chat($messages);

        // 解析工具调用（如果有）
        if (isset($response['tool_calls'])) {
            $toolResults = $this->executeTools($response['tool_calls']);

            $messages[] = [
                'role' => 'tool',
                'content' => json_encode($toolResults),
            ];

            return [
                'response' => $response['content'] ?? '',
                'token_count' => $response['token_count'] ?? 0,
                'variables' => ['tool_results' => $toolResults],
            ];
        }

        return [
            'response' => $response['content'] ?? '',
            'token_count' => $response['token_count'] ?? 0,
        ];
    }

    private function buildStepPrompt(array $step, array $variables): string
    {
        $context = '';
        if (!empty($variables)) {
            $context = "\n\n当前上下文变量：\n" . json_encode($variables, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }

        return "{$step['instruction']}{$context}";
    }

    private function executeTools(array $toolCalls): array
    {
        $results = [];
        foreach ($toolCalls as $call) {
            // 工具执行逻辑（简化示例）
            $results[] = [
                'tool' => $call['function']['name'],
                'result' => "Tool {$call['function']['name']} executed",
            ];
        }
        return $results;
    }
}
```

### 6. 审批控制器

```php
<?php

// app/Http/Controllers/AgentApprovalController.php

namespace App\Http\Controllers;

 =

();


blue blue-blueblue = =等多种</</ {
 and on |. = on>
;


 {
 on</
。






;


y
</Controller




agent</

Http>
</
>
 and══
 AppIlluminate</</ Agent

 App>
 Illuminate App;

Controller App>


 Controller/App App HTTP\ Controller/App ControllersHttpControllerController;

extends App
 class
 App Controller AgentHttpController>
class� app
 appHttp══Agent Controller App App

Controller extends app/
� publicController('agent AgentApproval publicController agentAgent Agent AgentAgent� return $   session_id" => $checkpoint->session_id,
            'step_name' => $checkpoint->step_name,
            'messages' => $checkpoint->messages,
        ]);
    }
}
```

### 7. 超时监控与自动恢复

```php
<?php

// app/Console/Commands/MonitorAgentWorkflows.php

namespace App\Console\Commands;

use App\Models\AgentCheckpoint;
use App\Services\AgentCheckpointManager;
use App\Services\AgentWorkflowEngine;
use Illuminate\Console\Command;

class MonitorAgentWorkflows extends Command
{
    protected $signature = 'agent:monitor';
    protected $description = '监控长时间运行的 Agent 工作流，自动恢复超时的 Checkpoint';

    public function __construct(
        private readonly AgentCheckpointManager $checkpointManager,
        private readonly AgentWorkflowEngine $engine,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        // 查找超过 10 分钟未更新的 active checkpoint
        $staleCheckpoints = AgentCheckpoint::where('status', 'active')
            ->where('updated_at', '<', now()->subMinutes(10))
            ->get();

        foreach ($staleCheckpoints as $checkpoint) {
            $this->warn("Found stale checkpoint: {$checkpoint->checkpoint_id} (step: {$checkpoint->step_name})");

            // 尝试恢复
            $resumeData = $this->checkpointManager->resume($checkpoint->session_id);

            if ($resumeData && $resumeData['status'] === 'resumed') {
                $this->info("Resuming workflow: {$checkpoint->workflow_id}");

                // 重新加载工作流定义并继续执行
                // 这里需要根据实际 workflow_id 加载步骤定义
                // $this->engine->execute(..., $resumeData);
            }
        }

        $this->info("Monitor check completed. Processed {$staleCheckpoints->count()} stale checkpoints.");

        return Command::SUCCESS;
    }
}
```

注册到 Kernel：

```php
// app/Console/Kernel.php (Laravel 8)
protected $commands = [
    \App\Console\Commands\MonitorAgentWorkflows::class,
];

protected function schedule(Schedule $schedule): void
{
    $schedule->command('agent:monitor')->everyFiveMinutes();
}
```

---

## 踩坑记录

### 1. Checkpoint 膨胀问题

**问题**：每次保存完整对话历史，messages 数组迅速膨胀到几 MB，数据库查询变慢。

**解决方案**：
- 采用**增量快照**：Checkpoint 只保存自上次以来的增量 messages
- 对超过 100 条的 messages 做摘要压缩（用 LLM 总结前面的对话）
- 大型 tool_results 单独存储到文件系统，Checkpoint 只保存引用

```php
// 增量快照策略
public function saveIncremental(
    string $sessionId,
    int $stepNumber,
    array $newMessages,
    // ...
): AgentCheckpoint {
    $lastCheckpoint = AgentCheckpoint::forSession($sessionId)->latest()->first();
    
    $allMessages = $lastCheckpoint
        ? array_merge($lastCheckpoint->messages, $newMessages)
        : $newMessages;

    // 如果超过 200 条，压缩前面的消息
    if (count($allMessages) > 200) {
        $summary = $this->summarizeMessages(array_slice($allMessages, 0, -50));
        $allMessages = array_merge(
            [['role' => 'system', 'content' => $summary]],
            array_slice($allMessages, -50)
        );
    }

    // ... save
}
```

### 2. 并发 Checkpoint 写入冲突

**问题**：多个 Worker 同时写同一个 session 的 Checkpoint，导致 step_number 冲突。

**解决方案**：用数据库事务 + 乐观锁

```php
public function save(...): AgentCheckpoint
{
    return DB::transaction(function () {
        // 先获取最新 step_number
        $maxStep = AgentCheckpoint::forSession($this->sessionId)
            ->lockForUpdate()
            ->max('step_number') ?? -1;

        return AgentCheckpoint::create([
            'step_number' => $maxStep + 1,
            // ... 其他字段
        ]);
    });
}
```

### 3. LLM Token 超限导致恢复失败

**问题**：恢复时加载完整对话历史，总 Token 数超过模型限制。

**解决方案**：
- 恢复时做 Token 计数，如果超限则压缩历史
- 对关键信息做持久化摘要存储到 variables 中
- 恢复时只加载摘要 + 最近 N 条消息

```php
public function resumeWithTokenLimit(string $sessionId, int $maxTokens = 120000): ?array
{
    $resumeData = $this->resume($sessionId);
    if (!$resumeData || $resumeData['status'] !== 'resumed') {
        return $resumeData;
    }

    $currentTokens = $this->estimateTokens($resumeData['messages']);

    if ($currentTokens > $maxTokens) {
        // 压缩消息历史
        $resumeData['messages'] = $this->compressMessages(
            $resumeData['messages'],
            $maxTokens
        );
    }

    return $resumeData;
}

private function estimateTokens(array $messages): int
{
    // 粗略估算：1 token ≈ 4 字符
    $totalChars = 0;
    foreach ($messages as $msg) {
        $totalChars += mb_strlen($msg['content'] ?? '');
    }
    return (int) ceil($totalChars / 4);
}
```

### 4. 审批恢复点的消息一致性

**问题**：审批恢复点保存了暂停消息，恢复后 Agent 重复执行暂停前的步骤。

**解决方案**：在恢复时检查最近一条消息是否是审批提示，如果是则跳过

```php
public function resume(string $sessionId): ?array
{
    $resumeData = $this->resumeRaw($sessionId);
    
    if (!$resumeData) return null;

    // 检查最后一条消息是否是审批提示
    $lastMessage = end($resumeData['messages']);
    if (str_starts_with($lastMessage['content'] ?? '', '⏸️ 暂停等待人工审批')) {
        // 标记恢复后跳过当前步骤
        $resumeData['skip_current_step'] = true;
    }

    return $resumeData;
}
```

---

## 总结

AI Agent 的断点恢复不是"nice to have"，而是生产级 Agent 系统的**刚需**。本文实现的方案核心思路：

1. **Checkpoint 是 Agent 的 WAL**：每步写快照，崩溃可恢复
2. **状态分离**：agent_state / messages / variables 分别序列化，避免单体膨胀
3. **审批恢复点**：关键步骤暂停等待人类，不阻塞整个系统
4. **自动监控**：定期扫描超时 Checkpoint，自动恢复

在 KKday B2C API 的实际场景中，这套机制可以用于：
- 定价 Agent：长时间运行的价格计算 + 人工审批最终报价
- 数据迁移 Agent：批量处理 + 检查点 + 失败重试
- 内容生成 Agent：调研 → 撰写 → 人工审校 → 发布

记住：**没有 Checkpoint 的 Agent 只是 demo，有 Checkpoint 的 Agent 才是产品。**
