---

title: AI Agent Versioning 实战：Prompt/Tool/Memory 的版本化管理
keywords: [AI Agent Versioning, Prompt, Tool, Memory, 的版本化管理, AI]
date: 2026-06-09 18:08:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- AI Agent
- Prompt Engineering
- DevOps
- GitOps
- Laravel
description: AI Agent 不是写完就完事。Prompt 会改、Tool 会加、Memory 会膨胀——如何像管理代码一样管理 Agent 的三大核心资产？本文用 Git-backed 配置 + 蓝绿部署的思路，给出一套可落地的版本化方案。
---


## 为什么 Agent 需要版本化？

写一个 AI Agent demo 很快：一个 system prompt、几个 tool function、接个 LLM API，半小时搞定。

但当你把它推上生产，问题就来了：

- **Prompt 改了一个词，用户反馈回答质量下降了**——你能回滚到上一版吗？
- **Tool 新增了一个参数，旧的调用全报错了**——你知道是哪次发布引入的吗？
- **Memory 越积越多，Agent 的回答开始「人格分裂」**——你能重置到某个基线状态吗？

传统软件靠 Git 管版本、靠 CI/CD 管发布。AI Agent 也该如此——只不过版本化的对象从代码变成了 **Prompt（指令）、Tool（能力）、Memory（记忆）** 这三样东西。

本文用 Laravel + PHP 实现一套完整的 Agent 版本化方案，包含 Git-backed 配置管理、版本对比、蓝绿部署、以及回滚机制。

## 核心概念：Agent 的三大资产

### 1. Prompt — Agent 的「性格」

System prompt 定义了 Agent 是谁、怎么说话、什么能做什么不能做。它是最敏感的资产——改一个字，行为可能完全不同。

```
你是一个电商客服助手。
规则：
1. 只回答与订单相关的问题
2. 不透露内部价格策略
3. 退款问题必须转人工
```

### 2. Tool — Agent 的「手」

Tool 是 Agent 能调用的函数：查订单、发邮件、写数据库。每个 tool 有名字、参数 schema、执行逻辑。版本化要关注的是 **接口契约**——参数变了，调用方就崩了。

### 3. Memory — Agent 的「脑」

短期记忆（对话上下文）、长期记忆（用户偏好、历史交互）。Memory 不像 prompt 那样可以简单回滚，但需要 **快照** 和 **基线管理**——当 memory 被污染或膨胀时，能重置到一个干净的状态。

## 实战：Git-backed Agent 配置管理

### 目录结构设计

把 Agent 的配置当作代码来管理：

```
agent-config/
├── agents/
│   └── customer-service/
│       ├── manifest.json          # Agent 元信息
│       ├── prompts/
│       │   ├── v1.0.0.md
│       │   ├── v1.1.0.md
│       │   └── current.md → v1.1.0.md  # 软链接指向当前版本
│       ├── tools/
│       │   ├── v1.0.0.json
│       │   └── v1.1.0.json
│       └── memory/
│           ├── baseline-v1.json   # 记忆基线快照
│           └── baseline-v2.json
├── changelog.md
└── deploy.log
```

### manifest.json

```json
{
  "agent_id": "customer-service",
  "version": "1.1.0",
  "prompt_version": "v1.1.0",
  "tools_version": "v1.1.0",
  "memory_baseline": "baseline-v2",
  "created_at": "2026-06-01T10:00:00Z",
  "updated_at": "2026-06-09T18:00:00Z",
  "deployed": true,
  "deploy_slot": "blue"
}
```

### 用 Laravel 实现版本管理服务

#### AgentVersion 模型

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AgentVersion extends Model
{
    protected $fillable = [
        'agent_id',
        'version',
        'prompt_hash',
        'prompt_content',
        'tools_schema',
        'memory_baseline',
        'status',        // draft, active, archived, rolled_back
        'deploy_slot',   // blue, green, null
        'changelog',
    ];

    protected $casts = [
        'tools_schema' => 'array',
        'memory_baseline' => 'array',
    ];

    public function agent()
    {
        return $this->belongsTo(Agent::class);
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function diff(AgentVersion $other): array
    {
        $changes = [];

        if ($this->prompt_hash !== $other->prompt_hash) {
            $changes['prompt'] = [
                'from' => $other->version,
                'to' => $this->version,
                'diff' => $this->computeTextDiff(
                    $other->prompt_content,
                    $this->prompt_content
                ),
            ];
        }

        if ($this->tools_schema !== $other->tools_schema) {
            $changes['tools'] = [
                'from' => $other->version,
                'to' => $this->version,
                'added' => array_diff_key(
                    $this->tools_schema ?? [],
                    $other->tools_schema ?? []
                ),
                'removed' => array_diff_key(
                    $other->tools_schema ?? [],
                    $this->tools_schema ?? []
                ),
            ];
        }

        return $changes;
    }

    private function computeTextDiff(string $old, string $new): string
    {
        // 简单的行级 diff，生产环境可用 sebastian/diffmann
        $oldLines = explode("\n", $old);
        $newLines = explode("\n", $new);
        $diff = [];

        $max = max(count($oldLines), count($newLines));
        for ($i = 0; $i < $max; $i++) {
            $oldLine = $oldLines[$i] ?? null;
            $newLine = $newLines[$i] ?? null;

            if ($oldLine !== $newLine) {
                if ($oldLine !== null) {
                    $diff[] = "- {$oldLine}";
                }
                if ($newLine !== null) {
                    $diff[] = "+ {$newLine}";
                }
            }
        }

        return implode("\n", $diff);
    }
}
```

#### Agent 版本管理 Service

```php
<?php

namespace App\Services;

use App\Models\Agent;
use App\Models\AgentVersion;
use Illuminate\Support\Facades\DB;

class AgentVersionService
{
    /**
     * 创建新版本（草稿状态）
     */
    public function createVersion(
        Agent $agent,
        string $prompt,
        array $tools,
        ?array $memoryBaseline = null,
        string $changelog = ''
    ): AgentVersion {
        $latestVersion = $agent->versions()->latest()->first();
        $newVersionNumber = $latestVersion
            ? $this->bumpVersion($latestVersion->version, 'minor')
            : '1.0.0';

        return $agent->versions()->create([
            'version' => $newVersionNumber,
            'prompt_hash' => md5($prompt),
            'prompt_content' => $prompt,
            'tools_schema' => $tools,
            'memory_baseline' => $memoryBaseline,
            'status' => 'draft',
            'changelog' => $changelog,
        ]);
    }

    /**
     * 蓝绿部署：将新版本部署到非活跃 slot
     */
    public function deploy(AgentVersion $version): array
    {
        $agent = $version->agent;
        $currentActive = $agent->versions()
            ->where('status', 'active')
            ->first();

        // 确定目标 slot
        $targetSlot = ($currentActive?->deploy_slot === 'blue')
            ? 'green'
            : 'blue';

        return DB::transaction(function () use (
            $version,
            $currentActive,
            $targetSlot,
            $agent
        ) {
            // 1. 新版本部署到目标 slot
            $version->update([
                'status' => 'active',
                'deploy_slot' => $targetSlot,
            ]);

            // 2. 旧版本标记为 archived
            if ($currentActive) {
                $currentActive->update([
                    'status' => 'archived',
                    'deploy_slot' => null,
                ]);
            }

            // 3. 更新 agent 当前版本指针
            $agent->update([
                'current_version_id' => $version->id,
            ]);

            return [
                'deployed_version' => $version->version,
                'slot' => $targetSlot,
                'previous_version' => $currentActive?->version,
                'previous_slot' => $currentActive?->deploy_slot,
            ];
        });
    }

    /**
     * 回滚到指定版本
     */
    public function rollback(Agent $agent, string $targetVersion): array
    {
        $target = $agent->versions()
            ->where('version', $targetVersion)
            ->firstOrFail();

        $current = $agent->currentVersion;

        // 先创建一个基于目标版本的新版本（而不是直接激活旧版本）
        $rollbackVersion = $this->createVersion(
            $agent,
            $target->prompt_content,
            $target->tools_schema,
            $target->memory_baseline,
            "Rollback from {$current->version} to {$targetVersion}"
        );

        return $this->deploy($rollbackVersion);
    }

    /**
     * 对比两个版本
     */
    public function compare(
        Agent $agent,
        string $versionA,
        string $versionB
    ): array {
        $a = $agent->versions()->where('version', $versionA)->firstOrFail();
        $b = $agent->versions()->where('version', $versionB)->firstOrFail();

        return $a->diff($b);
    }

    /**
     * Memory 快照：保存当前 memory 状态作为基线
     */
    public function snapshotMemory(
        Agent $agent,
        string $label = ''
    ): array {
        $memoryStore = app(MemoryStore::class);
        $currentMemory = $memoryStore->export($agent->id);

        $snapshot = [
            'label' => $label ?: 'snapshot-' . now()->format('YmdHis'),
            'created_at' => now()->toIso8601String(),
            'short_term' => $currentMemory['short_term'] ?? [],
            'long_term' => $currentMemory['long_term'] ?? [],
            'metadata' => [
                'total_entries' => count($currentMemory['long_term'] ?? []),
                'agent_version' => $agent->currentVersion?->version,
            ],
        ];

        // 保存到版本记录
        $agent->currentVersion?->update([
            'memory_baseline' => $snapshot,
        ]);

        return $snapshot;
    }

    /**
     * 重置 Memory 到某个基线
     */
    public function resetMemory(
        Agent $agent,
        string $baselineLabel
    ): bool {
        $version = $agent->versions()
            ->whereJsonContains('memory_baseline->label', $baselineLabel)
            ->firstOrFail();

        $baseline = $version->memory_baseline;
        $memoryStore = app(MemoryStore::class);

        // 清空当前 memory
        $memoryStore->clear($agent->id);

        // 导入基线
        $memoryStore->import($agent->id, $baseline);

        return true;
    }

    private function bumpVersion(string $version, string $type): string
    {
        $parts = explode('.', $version);
        [$major, $minor, $patch] = array_map('intval', $parts);

        return match ($type) {
            'major' => ($major + 1) . '.0.0',
            'minor' => $major . '.' . ($minor + 1) . '.0',
            'patch' => $major . '.' . $minor . '.' . ($patch + 1),
            default => $version,
        };
    }
}
```

### Tool Schema 版本化

Tool 的版本化重点是 **参数兼容性**。新增参数必须有默认值，不能破坏已有调用：

```php
<?php

namespace App\Services;

class ToolSchemaManager
{
    /**
     * 注册 tool schema，校验向后兼容性
     */
    public function register(
        string $toolName,
        array $newSchema,
        ?array $currentSchema = null
    ): array {
        if ($currentSchema === null) {
            return ['compatible' => true, 'schema' => $newSchema];
        }

        $issues = [];

        // 检查：不能移除已有必填参数
        $currentRequired = $currentSchema['required'] ?? [];
        $newRequired = $newSchema['required'] ?? [];
        $removedRequired = array_diff($currentRequired, $newRequired);

        // 移除 required 字段是破坏性变更
        // 但这里检查的是 required 列表中被完全删除的参数
        $currentParams = array_keys($currentSchema['parameters'] ?? []);
        $newParams = array_keys($newSchema['parameters'] ?? []);
        $removedParams = array_diff($currentParams, $newParams);

        if (!empty($removedParams)) {
            $issues[] = [
                'type' => 'breaking',
                'message' => "移除了参数: " . implode(', ', $removedParams),
            ];
        }

        // 检查：新增的 required 参数没有默认值
        $addedRequired = array_diff($newRequired, $currentRequired);
        foreach ($addedRequired as $param) {
            if (!isset($newSchema['parameters'][$param]['default'])) {
                $issues[] = [
                    'type' => 'breaking',
                    'message' => "新增必填参数 {$param} 没有默认值",
                ];
            }
        }

        // 检查：参数类型变更
        foreach ($currentParams as $param) {
            if (isset($newSchema['parameters'][$param])) {
                $oldType = $currentSchema['parameters'][$param]['type'] ?? null;
                $newType = $newSchema['parameters'][$param]['type'] ?? null;

                if ($oldType && $newType && $oldType !== $newType) {
                    $issues[] = [
                        'type' => 'breaking',
                        'message' => "参数 {$param} 类型从 {$oldType} 变为 {$newType}",
                    ];
                }
            }
        }

        $hasBreaking = collect($issues)->contains('type', 'breaking');

        return [
            'compatible' => !$hasBreaking,
            'issues' => $issues,
            'schema' => $newSchema,
        ];
    }
}
```

## 蓝绿 Agent 部署

蓝绿部署的核心思想：**同时维护两个完全一样的 Agent 实例，切换流量时只需要改路由指针**。

### 部署流程

```
当前状态：Blue (v1.0) 处理 100% 流量
                    ↓
1. 在 Green slot 部署 v1.1
2. 健康检查：发送 10 个测试 prompt，验证输出
                    ↓
健康检查通过？
   ├── 是 → 3. 流量切换到 Green
   │        4. Blue 保留 30 分钟用于快速回滚
   │        5. 30 分钟后 Blue 标记为 archived
   │
   └── 否 → 回滚 Green，Blue 继续服务
```

### 实现部署 Pipeline

```php
<?php

namespace App\Services\Deploy;

use App\Models\Agent;
use App\Models\AgentVersion;

class BlueGreenDeployer
{
    public function __construct(
        private HealthChecker $healthChecker,
        private TrafficRouter $router,
        private AgentVersionService $versionService,
    ) {}

    public function deploy(AgentVersion $version): DeployResult
    {
        $agent = $version->agent;
        $targetSlot = $this->determineTargetSlot($agent);

        // Step 1: 部署到目标 slot
        $this->deployToSlot($version, $targetSlot);

        // Step 2: 健康检查
        $healthResult = $this->healthChecker->check($version, [
            'test_prompts' => $this->getTestPrompts($agent),
            'timeout_seconds' => 30,
            'min_success_rate' => 0.9,
        ]);

        if (!$healthResult->passed) {
            $this->rollbackSlot($targetSlot);
            return DeployResult::failed($healthResult->failures);
        }

        // Step 3: 切换流量
        $this->router->switch($agent, $targetSlot);

        // Step 4: 更新版本状态
        $deployInfo = $this->versionService->deploy($version);

        // Step 5: 调度延迟清理（30 分钟后下线旧 slot）
        $oldSlot = $targetSlot === 'blue' ? 'green' : 'blue';
        CleanupOldSlot::dispatch($agent, $oldSlot)
            ->delay(now()->addMinutes(30));

        return DeployResult::success($deployInfo);
    }

    private function determineTargetSlot(Agent $agent): string
    {
        $current = $agent->currentVersion;
        return ($current?->deploy_slot === 'blue') ? 'green' : 'blue';
    }

    private function deployToSlot(
        AgentVersion $version,
        string $slot
    ): void {
        // 将 prompt/tools/memory 推送到对应 slot 的运行时
        $runtime = $this->getSlotRuntime($version->agent, $slot);
        $runtime->loadPrompt($version->prompt_content);
        $runtime->loadTools($version->tools_schema);
        $runtime->loadMemory($version->memory_baseline);
    }

    private function getSlotRuntime(Agent $agent, string $slot): AgentRuntime
    {
        return match ($slot) {
            'blue' => app('agent.runtime.blue', ['agent' => $agent]),
            'green' => app('agent.runtime.green', ['agent' => $agent]),
        };
    }
}
```

### 健康检查

部署前必须验证新版本能正常工作：

```php
<?php

namespace App\Services\Deploy;

class HealthChecker
{
    public function check(
        AgentVersion $version,
        array $config
    ): HealthResult {
        $prompts = $config['test_prompts'];
        $timeout = $config['timeout_seconds'];
        $minRate = $config['min_success_rate'];

        $results = [];
        $runtime = $this->getIsolatedRuntime($version);

        foreach ($prompts as $testPrompt) {
            $start = microtime(true);

            try {
                $response = $runtime->chat($testPrompt['input'], [
                    'timeout' => $timeout,
                ]);

                $latency = (microtime(true) - $start) * 1000;

                $results[] = [
                    'prompt' => $testPrompt['input'],
                    'success' => $this->validateResponse(
                        $response,
                        $testPrompt['expected'] ?? null
                    ),
                    'latency_ms' => $latency,
                    'response_preview' => mb_substr($response, 0, 100),
                ];
            } catch (\Throwable $e) {
                $results[] = [
                    'prompt' => $testPrompt['input'],
                    'success' => false,
                    'error' => $e->getMessage(),
                ];
            }
        }

        $successCount = collect($results)->where('success', true)->count();
        $successRate = $successCount / count($results);

        return new HealthResult(
            passed: $successRate >= $minRate,
            successRate: $successRate,
            results: $results,
            failures: collect($results)
                ->where('success', false)
                ->all()
        );
    }

    private function validateResponse(
        string $response,
        ?array $expected
    ): bool {
        if (!$expected) {
            // 没有预期结果，只要返回非空就算通过
            return !empty(trim($response));
        }

        // 检查是否包含预期关键词
        if (isset($expected['contains'])) {
            foreach ((array) $expected['contains'] as $keyword) {
                if (!str_contains($response, $keyword)) {
                    return false;
                }
            }
        }

        // 检查是否不包含禁止词
        if (isset($expected['not_contains'])) {
            foreach ((array) $expected['not_contains'] as $keyword) {
                if (str_contains($response, $keyword)) {
                    return false;
                }
            }
        }

        return true;
    }
}
```

## 对比视图：版本之间到底改了什么

给运营/PM 看的版本对比界面，不需要懂代码：

```php
<?php

namespace App\Http\Controllers;

use App\Models\Agent;

class AgentVersionController extends Controller
{
    public function compare(
        Agent $agent,
        string $v1,
        string $v2
    ) {
        $diff = app(AgentVersionService::class)
            ->compare($agent, $v1, $v2);

        return response()->json([
            'agent' => $agent->id,
            'versions' => [$v1, $v2],
            'changes' => $diff,
            'summary' => $this->humanizeDiff($diff),
        ]);
    }

    private function humanizeDiff(array $diff): string
    {
        $parts = [];

        if (isset($diff['prompt'])) {
            $lineCount = substr_count($diff['prompt']['diff'], "\n");
            $parts[] = "Prompt 有 {$lineCount} 行变更";
        }

        if (isset($diff['tools'])) {
            $added = count($diff['tools']['added'] ?? []);
            $removed = count($diff['tools']['removed'] ?? []);
            if ($added) {
                $parts[] = "新增 {$added} 个 Tool";
            }
            if ($removed) {
                $parts[] = "移除 {$removed} 个 Tool";
            }
        }

        return implode('；', $parts) ?: '无变更';
    }
}
```

## 踩坑记录

### 1. Prompt 微调 ≠ 小改动

**坑**：产品经理说「就改了一个词」，结果 Agent 的回答风格完全变了。

**解**：任何 prompt 变更都必须经过健康检查。不要相信「小改动」，用测试 prompt 验证实际输出。

### 2. Memory 快照会很大

**坑**：长期运行的 Agent，memory 可能有几万条记录。每次版本化都存一份完整快照，存储成本爆炸。

**解**：用增量快照。只记录和上一个 baseline 的 diff：

```php
public function incrementalSnapshot(Agent $agent): array
{
    $current = $this->memoryStore->export($agent->id);
    $lastBaseline = $agent->currentVersion?->memory_baseline ?? [];

    return [
        'type' => 'incremental',
        'base_version' => $agent->currentVersion?->version,
        'added' => array_diff_key(
            $current['long_term'] ?? [],
            $lastBaseline['long_term'] ?? []
        ),
        'removed' => array_diff_key(
            $lastBaseline['long_term'] ?? [],
            $current['long_term'] ?? []
        ),
    ];
}
```

### 3. Tool Schema 的隐式破坏

**坑**：给 tool 的一个参数改了类型（string → int），没报错，但所有历史调用记录解析全失败了。

**解**：在 CI 里加 schema 兼容性检查：

```bash
# .github/workflows/agent-ci.yml
- name: Check Tool Schema Compatibility
  run: |
    php artisan agent:check-schema-compat \
      --agent=customer-service \
      --base=main \
      --head=$GITHUB_SHA
```

### 4. 蓝绿切换不是瞬间完成

**坑**：蓝绿切换时，有请求打到了正在销毁的旧 slot 上。

**解**：切换时加一个 5 秒的 **双写期**——两个 slot 同时接收请求，但只有新 slot 的结果返回给用户。5 秒后旧 slot 才停止接收。

## 总结

| 维度 | 不做版本化 | 做版本化 |
|------|-----------|---------|
| Prompt 出问题 | 靠记忆回滚，祈祷没改错 | `git diff` + 一键回滚 |
| Tool 接口变更 | 上线后才发现破坏了调用方 | CI 自动检测兼容性 |
| Memory 膨胀 | 只能重启清空 | 快照 + 基线重置 |
| 部署 | 全量替换，出问题就停服 | 蓝绿部署，秒级切换 |
| 审计 | 「谁改的？什么时候？」 | Git log 全记录 |

Agent 版本化不是过度工程，而是 Agent 从 demo 到产品的必经之路。当你第一次因为 prompt 改动导致线上事故时，你就会庆幸有这套机制。

核心原则就一句话：**像管理代码一样管理 Agent 的三大资产——Prompt、Tool、Memory。**
