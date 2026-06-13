---
title: 'Prompt Caching 实战：Anthropic/OpenAI 缓存策略对比——System Prompt 复用、KV Cache 与成本优化的工程化落地'
date: 2026-06-06 10:00:00
tags: [Prompt Caching, LLM, AI, 成本优化, Anthropic, OpenAI, KV Cache, System Prompt]
keywords: [Prompt Caching, Anthropic, OpenAI, System Prompt, KV Cache, 缓存策略对比, 复用, 与成本优化的工程化落地, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "Prompt Caching 是降低 LLM API 成本的关键技术。本文深度对比 Anthropic 与 OpenAI 的缓存策略——Anthropic 的显式 cache_control 标记可节省 90% 输入费用，OpenAI 的自动缓存无需代码改动即享 50% 折扣。详解 KV Cache 底层原理、System Prompt 前缀优化黄金法则、缓存失效陷阱，并提供 Laravel/PHP 与 Python 的完整工程化集成方案，含成本计算、监控告警与生产部署 Checklist。"
---


在生产级 LLM 应用中，每次 API 调用都伴随 token 计费。当 System Prompt 长达数千 token、Tool 定义和 Few-shot 示例占据大量上下文时，重复计算相同前缀的代价极其高昂。**Prompt Caching** 正是解决这一痛点的核心技术——通过服务端缓存已完成计算的 KV Cache，避免对相同前缀的重复处理，实现高达 90% 的成本节省和显著的延迟降低。本文将深入对比 Anthropic 与 OpenAI 的缓存实现，剖析底层原理，并给出 Laravel/PHP 工程化落地方案。

## 一、KV Cache 与前缀匹配原理

### 1.1 Transformer 推理的计算瓶颈

自回归 LLM 生成每个 token 时，需对所有前置 token 做注意力计算（Attention），时间复杂度 O(N²)。当 System Prompt + Tool 定义 + Few-shot 通常占 2000-5000 token 时，每个请求都在重复计算这些静态内容。

### 1.2 KV Cache 机制

**KV Cache** 将每一层 Transformer 已计算的 Key/Value 向量存储起来，后续请求只需为新 token 计算 Q/K/V，与缓存的 KV 做注意力运算。Prompt Caching 的本质就是**服务端持久化这些 KV Cache，跨请求复用**。

```
Input Tokens → [Embedding] → Layer 1 → ... → Layer N
                       │
                  Q, K, V 计算
                       │
              ┌────────┴────────┐
              ▼                 ▼
        KV Cache (已缓存)   新 token 的 Q
              │                 │
              └───────┬─────────┘
                      ▼
              Attention → Softmax → Output
```

### 1.3 前缀匹配原则

两家厂商都基于**前缀匹配**（Prefix Matching）：新请求的前 N 个 token 必须与已缓存内容**逐 token 完全一致**才能命中。因此 prompt 的组织顺序至关重要——**静态内容放前面，动态内容放最后**。

## 二、Anthropic 显式缓存 vs OpenAI 自动缓存

### 2.1 Anthropic：`cache_control` 显式标记

开发者通过 `cache_control` 字段手动标记需缓存的段落，最多设置 **4 个缓存断点**，按顺序匹配：

```json
{
  "system": [
    {"type": "text", "text": "基础系统指令...", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "工具定义 JSON...", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "Few-shot 示例...", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "动态用户上下文..."}
  ]
}
```

`ephemeral` 表示缓存生命周期约 5 分钟（无请求续期则过期）。请求到达时逐段匹配——若第一个断点命中则 100% 复用；若前两个都命中，则第二个之后的内容仍需重新计算。

### 2.2 OpenAI：全自动隐式缓存

无需任何代码改动——请求前缀 ≥1024 token 时自动缓存，基于精确前缀匹配，TTL 约 5-10 分钟，命中时输入费用减半（50% 折扣）。API 响应中 `prompt_tokens_details.cached_tokens` 字段可查看缓存命中的 token 数。

### 2.3 对比总结

| 维度 | Anthropic | OpenAI |
|------|-----------|--------|
| 控制方式 | 显式 `cache_control` 标记 | 全自动，无需代码 |
| 最小 token 门槛 | ≥2048 | ≥1024 |
| 缓存断点 | 最多 4 个，手动设置 | 单一前缀，自动匹配 |
| TTL | ~5 分钟 | ~5-10 分钟 |
| 命中折扣 | **90%**（$0.30/M） | 50%（半价） |
| 写入成本 | 溢价 25%（$3.75/M） | 无额外费用 |
| 调试字段 | `cache_creation_input_tokens` / `cache_read_input_tokens` | `cached_tokens` |

## 三、System Prompt 复用的工程化策略

### 3.1 前缀组织黄金法则

```
┌───────────────────────────────────┐
│     静态前缀（缓存目标）           │
│  1. 基础系统指令（角色、规则）     │
│  2. 工具/函数定义 JSON             │
│  3. Few-shot 示例                  │
├───────────────────────────────────┤
│     动态后缀（不缓存）             │
│  4. 用户上下文（订单信息等）       │
│  5. 当前对话历史                   │
│  6. 用户最新消息                   │
└───────────────────────────────────┘
```

### 3.2 关键原则

- **禁止在前缀中间插入动态内容**（用户名、时间戳、请求 ID）
- **Few-shot 示例按固定 ID 排序**，避免随机顺序破坏前缀一致性
- **工具定义使用 DTO 序列化**，确保 JSON 字段顺序稳定

## 四、Laravel/PHP 集成示例

### 4.1 Anthropic 缓存集成

```php
<?php
namespace App\Services;

use GuzzleHttp\Client;

class ClaudeService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(['base_uri' => 'https://api.anthropic.com', 'timeout' => 60]);
    }

    public function chat(array $messages, string $systemPrompt, array $toolDefs): array
    {
        $response = $this->client->post('/v1/messages', [
            'headers' => [
                'x-api-key' => config('services.anthropic.api_key'),
                'anthropic-version' => '2023-06-01',
                'content-type' => 'application/json',
            ],
            'json' => [
                'model' => 'claude-sonnet-4-20250514',
                'max_tokens' => 2048,
                'system' => [
                    // 静态指令 → 缓存断点 1
                    ['type' => 'text', 'text' => $systemPrompt,
                     'cache_control' => ['type' => 'ephemeral']],
                    // 工具定义 → 缓存断点 2
                    ['type' => 'text', 'text' => json_encode($toolDefs, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
                     'cache_control' => ['type' => 'ephemeral']],
                ],
                'messages' => $messages,
            ],
        ]);

        $data = json_decode($response->getBody(), true);
        $this->logCacheMetrics($data['usage'] ?? []);
        return $data;
    }

    private function logCacheMetrics(array $usage): void
    {
        $read = $usage['cache_read_input_tokens'] ?? 0;
        $create = $usage['cache_creation_input_tokens'] ?? 0;
        $input = $usage['input_tokens'] ?? 0;
        $hitRate = ($read + $input) > 0 ? round($read / ($read + $input) * 100, 1) : 0;

        \Log::info('claude.cache_metrics', [
            'cache_read' => $read, 'cache_create' => $create,
            'input' => $input, 'hit_rate' => "{$hitRate}%",
        ]);
    }
}
```

### 4.2 OpenAI 集成（自动缓存）

```php
// OpenAI 自动缓存 ≥1024 token 的前缀，确保 system 消息在最前面即可
$response = $client->post('https://api.openai.com/v1/chat/completions', [
    'headers' => ['Authorization' => 'Bearer ' . $apiKey, 'Content-Type' => 'application/json'],
    'json' => ['model' => 'gpt-4o', 'messages' => $messages, 'max_tokens' => 2048],
]);
$data = json_decode($response->getBody(), true);
$cached = $data['usage']['prompt_tokens_details']['cached_tokens'] ?? 0;
\Log::info('openai.cache', ['cached_tokens' => $cached]);
```

### 4.3 Python 集成示例

```python
import anthropic
import openai
from functools import lru_cache
import hashlib
import json

# ============================================================
# Anthropic：显式缓存控制
# ============================================================
class ClaudeCacheService:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def chat(self, messages: list, system_prompt: str, tool_defs: list) -> dict:
        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=[
                # 静态指令 → 缓存断点 1
                {"type": "text", "text": system_prompt,
                 "cache_control": {"type": "ephemeral"}},
                # 工具定义 → 缓存断点 2
                {"type": "text", "text": json.dumps(tool_defs, ensure_ascii=False),
                 "cache_control": {"type": "ephemeral"}},
            ],
            messages=messages,
        )
        usage = response.usage
        hit_rate = (
            round(usage.cache_read_input_tokens / (usage.cache_read_input_tokens + usage.input_tokens) * 100, 1)
            if (usage.cache_read_input_tokens + usage.input_tokens) > 0 else 0
        )
        print(f"[Claude] cache_read={usage.cache_read_input_tokens}, "
              f"cache_create={usage.cache_creation_input_tokens}, "
              f"input={usage.input_tokens}, hit_rate={hit_rate}%")
        return response.model_dump()


# ============================================================
# OpenAI：自动缓存，确保 system 消息在最前面
# ============================================================
class OpenAICacheService:
    def __init__(self):
        self.client = openai.OpenAI()

    def chat(self, messages: list, system_prompt: str) -> dict:
        # 将 system prompt 置于 messages 最前方，确保前缀一致
        full_messages = [{"role": "system", "content": system_prompt}] + messages
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=full_messages,
            max_tokens=2048,
        )
        cached = response.usage.prompt_tokens_details.cached_tokens if response.usage.prompt_tokens_details else 0
        print(f"[OpenAI] cached_tokens={cached}, total_prompt={response.usage.prompt_tokens}")
        return response.model_dump()
```

## 五、成本优化实战计算

假设客服机器人：System Prompt 3000 token，每天 10,000 次调用。

### Anthropic 计算

```
无缓存：3000 × 10,000 × $3/M = $90/天
有缓存（99%命中）：
  写入 = 3000 × 100 × $3.75/M = $1.125
  读取 = 3000 × 9,900 × $0.30/M = $8.91
  合计 ≈ $10/天 → 节省 88.8%
```

### 年度成本对比

| 方案 | 日费用 | 年费用 | 节省比例 |
|------|--------|--------|----------|
| Anthropic 无缓存 | $90 | $32,850 | 基准 |
| **Anthropic 有缓存** | **$10** | **$3,650** | **88.8%** |
| OpenAI 有缓存 | $39 | $14,235 | 56.7% |

> Anthropic 90% 命中折扣在高频场景下远超 OpenAI 的 50%。但注意：缓存写入溢价 25%，只有复用 ≥2 次才能回本。

## 六、缓存失效策略与常见陷阱

### 6.1 失效时机

```
自动失效：
  ├── TTL 过期（5-10 分钟无活动）
  ├── System Prompt 内容变更（哪怕一个字符）
  ├── 工具定义顺序/内容变化
  └── Anthropic：断点标记变更

主动失效：
  ├── 部署新版本（prompt 模板修改）
  ├── A/B 测试切换 prompt 版本
  └── 工具定义热更新
```

### 6.2 常见陷阱

**陷阱 1：动态内容插在前缀中间**
```php
// ❌ 动态用户名破坏前缀一致性
$system = "你是助手。当前用户：{$userName}。规则如下：...";
// ✅ 静态前缀 + 动态后缀
$system = "你是助手。规则如下：...";
$context = "当前用户：{$userName}"; // 放在 messages 中
```

**陷阱 2：Few-shot 示例顺序不稳定**
```php
// ❌ 随机排序
shuffle($examples);
// ✅ 固定排序
$examples = collect($examples)->sortBy('id')->values();
```

**陷阱 3：JSON 序列化不一致** — PHP 数组键顺序不确定，务必用 DTO 或 `ksort()` 确保工具定义的字段顺序稳定。

**陷阱 4：缓存冷启动的首次请求延迟**
```
场景：凌晨 0 点后首次请求，缓存已全部过期
  → 首次请求无缓存命中，耗时增加 30-50%
  → 对延迟敏感的 API（如 P99 < 2s）可能触发超时

解决方案：
  1. 预热脚本：定时任务每 4 分钟发送一次缓存预热请求
  2. 降级策略：首次请求超时时间设为正常的 2 倍
  3. 缓存预热 + 降级 = 双保险
```

```php
// 缓存预热脚本示例
class CacheWarmupCommand extends Command
{
    protected $signature = 'cache:warmup-claude';

    public function handle(ClaudeService $claude): int
    {
        // 发送最小请求触发缓存写入，不消耗输出 token
        $result = $claude->chat([], 'You are a helpful assistant.', []);
        $created = $result['usage']['cache_creation_input_tokens'] ?? 0;

        Log::info('cache_warmup', ['tokens_cached' => $created]);
        $this->info("Cache warmed: {$created} tokens cached");
        return 0;
    }
}

// Cron: */4 * * * * php artisan cache:warmup-claude
```

**陷阱 5：多轮对话中 system 消息被覆盖**

```python
# ❌ 多轮对话中错误地重复添加 system 消息
messages = [
    {"role": "system", "content": "You are a coding assistant."},
    {"role": "user", "content": "Write a function"},
    {"role": "assistant", "content": "def hello(): ..."},
    {"role": "system", "content": "You are a coding assistant."},  # 破坏前缀！
    {"role": "user", "content": "Now refactor it"},
]

# ✅ 正确做法：system 消息只在开头出现一次
messages = [
    {"role": "user", "content": "Write a function"},
    {"role": "assistant", "content": "def hello(): ..."},
    {"role": "user", "content": "Now refactor it"},
]
# system prompt 通过 API 的 system 参数传入，不放在 messages 中
```

**陷阱 6：Anthropic 断点位置选错导致缓存未命中**

```json
// ❌ 将 cache_control 放在动态内容上
{
  "system": [
    {"type": "text", "text": "短指令"},
    {"type": "text", "text": "{{user_context}}", "cache_control": {"type": "ephemeral"}}
  ]
}
// 动态内容每次都变 → 缓存永远命中不了 → 写入溢价白付

// ✅ 将 cache_control 放在最大的静态段落末尾
{
  "system": [
    {"type": "text", "text": "完整的 2000 字系统指令", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "工具定义 JSON"}
  ]
}
```

## 七、监控与调试

**缓存命中率监控**：在每次 API 调用后记录 `cache_read_input_tokens` / `cached_tokens`，计算命中率并告警（< 80% 触发排查）。

**排查清单**：
1. System Prompt 是否包含时间戳或动态 ID？
2. 工具定义的 JSON 序列化顺序是否稳定？
3. `cache_control` 标记位置是否正确？（Anthropic）
4. 前缀总长度是否满足最低门槛？（OpenAI ≥1024 token）
5. 是否有中间件修改了请求结构？

## 八、生产部署 Checklist

```
□ System Prompt 采用静态前缀 + 动态后缀结构
□ Anthropic：关键段落设置 cache_control 断点（≤4 个）
□ 工具定义使用 DTO 确保 JSON 序列化顺序一致
□ Few-shot 示例按固定 ID 排序
□ 缓存命中率监控告警（< 80% 触发）
□ 缓存 token 指标纳入成本仪表盘
□ 部署流水线包含 prompt 版本号
□ 请求超时 ≥ 缓存预热时间（首次请求可能较慢）
□ 定期审计 prompt 长度，删除冗余内容
```

## 九、总结

Prompt Caching 是生产级 LLM 应用的**必备基础设施**。Anthropic 的显式控制适合精细调优（90% 折扣），OpenAI 的自动缓存适合快速集成（50% 折扣）。核心原则只有一个：**让静态内容稳居前缀，让动态内容尾随其后**。在高频调用场景下，合理使用 Prompt Caching 可将输入成本降低 80-90%——这是任何模型价格战都无法匹敌的工程化红利。

## 相关阅读

- [Idempotency Key 深度实战：API 幂等性的三层防护](/categories/架构/2026-06-06-Idempotency-Key-深度实战-API幂等性的三层防护/)
- [Strangler Fig Pattern 深度实战：Laravel 单体到微服务的渐进式迁移](/categories/架构/2026-06-06-Strangler-Fig-Pattern-深度实战-Laravel单体到微服务的渐进式迁移-Anti-Corruption-Layer与事件驱动的双轨策略/)
- [Distributed Lock 深度对比：Redis Redlock vs Zookeeper vs etcd](/categories/架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/)
