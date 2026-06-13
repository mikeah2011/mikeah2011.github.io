---
title: AI Agent 多租户实战：SaaS 场景下的 Agent 隔离、用量计量与按租户路由——Laravel + LLM 的工程化方案
date: 2026-06-03 09:00:00
tags: [AI Agent, 多租户, SaaS, Laravel, LLM, 租户隔离]
keywords: [AI Agent, SaaS, Agent, Laravel, LLM, 多租户实战, 场景下的, 隔离, 用量计量与按租户路由, 的工程化方案]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 系统拆解多租户 AI Agent SaaS 平台的工程化落地方案：Laravel 实现行级租户隔离、LLM Token 精准计量与计费、按租户动态路由模型与 Prompt 模板、向量数据库 Embedding 隔离、SSE 流式响应中的租户标记、Rate Limit 成本控制策略。覆盖数据库设计、中间件架构、安全审计等全链路实践，适合构建 B2B AI 服务的技术团队参考。
---


## 引言

在 2025-2026 年的 AI 浪潮中，越来越多的企业开始将 LLM（Large Language Model）能力封装为面向多客户的 SaaS 产品。无论是客服机器人、代码助手、知识库问答，还是工作流自动化 Agent，一旦服务对象从"单一团队"扩展到"多个企业客户"，就不可避免地面临多租户架构的核心挑战：**如何在共享基础设施上为每个租户提供安全隔离、独立计费、灵活路由且成本可控的 AI Agent 服务？**

这不是一个简单的问题。传统多租户 Web 应用中我们熟悉的数据库行级隔离、Redis 命名空间、中间件鉴权等手段，在 AI Agent 场景下都会遭遇新的挑战：LLM 的 Token 消耗如何精确计量？不同租户的 Agent 使用不同的模型和 Prompt 模板时如何隔离配置？向量数据库中的 Embedding 数据如何防止跨租户泄露？SSE 流式响应中如何标记租户身份并持续计量？Rate Limit 如何在模型调用成本和用户体验间取得平衡？

本文将以 Laravel 作为后端框架，结合实际工程经验，系统性地拆解上述问题。我们将从架构设计、数据隔离、路由策略、用量计量、安全性等维度，给出一套完整的多租户 AI Agent 工程化方案。如果你正在构建或即将构建一个面向 B2B 客户的 AI Agent 平台，这篇文章会为你提供可落地的技术参考。

---

## 一、整体架构设计

### 1.1 架构全景

在正式讨论细节之前，我们先看全局。一个典型的多租户 AI Agent SaaS 平台，其核心架构可以拆解为以下层次：

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端层                                 │
│   Web SDK / Widget / API / Slack Bot / 企业微信 Bot / ...       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / WebSocket / SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                      网关层 (Gateway)                            │
│   租户识别 → 认证鉴权 → Rate Limit → 请求路由 → 日志采集        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                   Agent 服务层 (Laravel)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Agent    │  │ Prompt   │  │ 工具调用  │  │ 会话管理  │       │
│  │ 编排引擎 │  │ 模板引擎 │  │ (Tools)  │  │ & 记忆   │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    LLM 路由层                                    │
│   租户模型配置 → 供应商路由(Failover) → Token 计量 → 缓存       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                   基础设施层                                     │
│  MySQL (租户隔离) │ Redis (会话/缓存) │ 向量库 │ 对象存储       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 多租户识别的核心入口

多租户系统的第一步永远是：**识别当前请求属于哪个租户**。在 SaaS 场景下，常见的租户识别方式有以下几种：

| 方式 | 实现 | 适用场景 |
|------|------|----------|
| 子域名 | `tenant-abc.yourplatform.com` | Web 应用、管理后台 |
| URL 路径前缀 | `/api/v1/tenants/{tenant_id}/...` | REST API |
| HTTP Header | `X-Tenant-ID` 或 `X-Tenant-Slug` | API 服务、SDK 调用 |
| API Key 关联 | 每个 API Key 绑定一个租户 | 开放 API |
| JWT Claims | Token 中携带 `tenant_id` | 有状态会话 |

在 Laravel 中，我们推荐使用**中间件 + API Key 关联**的组合方式，因为 API Key 天然具备认证和租户识别的双重能力：

```php
// app/Http/Middleware/IdentifyTenant.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Models\Tenant;
use App\Models\ApiKey;
use App\Exceptions\TenantNotFoundException;

class IdentifyTenant
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'error' => 'missing_api_key',
                'message' => '请在 Authorization 头中提供有效的 API Key'
            ], 401);
        }

        // 通过缓存加速查找，避免每次请求都查数据库
        $apiKey = cache()->remember("apikey:{$token}", 300, function () use ($token) {
            return ApiKey::with('tenant')
                ->where('key_hash', hash('sha256', $token))
                ->where('is_active', true)
                ->first();
        });

        if (!$apiKey) {
            return response()->json([
                'error' => 'invalid_api_key',
                'message' => 'API Key 无效或已停用'
            ], 401);
        }

        $tenant = $apiKey->tenant;

        if (!$tenant || !$tenant->is_active) {
            return response()->json([
                'error' => 'tenant_inactive',
                'message' => '当前租户账户已被停用'
            ], 403);
        }

        // 注入到全局容器，供后续服务使用
        app()->instance('current_tenant', $tenant);
        app()->instance('current_api_key', $apiKey);

        return $next($request);
    }
}
```

### 1.3 租户模型设计

Tenant 模型是整个多租户系统的核心实体。在实际项目中，Tenant 的设计需要承载大量业务信息：

```php
// app/Models/Tenant.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Tenant extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name',
        'slug',
        'plan',              // free / starter / pro / enterprise
        'llm_config',        // JSON: 默认模型、备用模型、参数
        'rate_limit_config', // JSON: 各类限制配额
        'agent_config',      // JSON: Agent 全局配置
        'is_active',
        'billing_email',
        'trial_ends_at',
    ];

    protected $casts = [
        'llm_config'        => 'array',
        'rate_limit_config' => 'array',
        'agent_config'      => 'array',
        'is_active'         => 'boolean',
        'trial_ends_at'     => 'datetime',
    ];

    // 关联关系
    public function apiKeys()
    {
        return $this->hasMany(ApiKey::class);
    }

    public function agents()
    {
        return $this->hasMany(Agent::class);
    }

    public function usageRecords()
    {
        return $this->hasMany(UsageRecord::class);
    }

    public function conversations()
    {
        return $this->hasMany(Conversation::class);
    }

    /**
     * 获取该租户的 LLM 配置（含默认兜底）
     */
    public function getLlmConfig(): array
    {
        return array_merge([
            'default_model'     => 'gpt-4o-mini',
            'fallback_model'    => 'gpt-3.5-turbo',
            'temperature'       => 0.7,
            'max_tokens'        => 4096,
            'embedding_model'   => 'text-embedding-3-small',
            'allowed_models'    => ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
            'monthly_token_quota' => 1000000,  // 每月 Token 额度
        ], $this->llm_config ?? []);
    }

    /**
     * 获取 Rate Limit 配置
     */
    public function getRateLimitConfig(): array
    {
        $defaults = [
            'requests_per_minute'   => 30,
            'requests_per_hour'     => 500,
            'tokens_per_minute'     => 100000,
            'concurrent_requests'   => 5,
            'max_agents'            => 10,
            'max_knowledge_bases'   => 5,
            'max_file_size_mb'      => 20,
        ];

        // 根据 Plan 提升默认值
        $planLimits = [
            'free'       => ['requests_per_minute' => 5,  'monthly_token_quota' => 100000],
            'starter'    => ['requests_per_minute' => 30, 'monthly_token_quota' => 1000000],
            'pro'        => ['requests_per_minute' => 100, 'monthly_token_quota' => 10000000],
            'enterprise' => ['requests_per_minute' => 500, 'monthly_token_quota' => 100000000],
        ];

        $planKey = $this->plan ?? 'free';
        return array_merge($defaults, $planLimits[$planKey] ?? [], $this->rate_limit_config ?? []);
    }
}
```

---

## 二、数据隔离策略

数据隔离是多租户架构中最核心也最容易出问题的环节。在 AI Agent 场景下，数据的类型更加多样，除了传统的关系型数据，还有缓存数据、向量数据、文件数据、会话数据等。下面我们逐层拆解。

### 2.1 数据库隔离：三种模式对比

| 模式 | 实现方式 | 隔离程度 | 成本 | 适用场景 |
|------|----------|---------|------|----------|
| 独立数据库 | 每个租户一个 DB | 最强 | 高 | 金融/医疗/政府大客户 |
| 独立 Schema | 同一个 DB，不同 Schema | 强 | 中 | 中大型企业客户 |
| 共享表 + 租户ID列 | 所有表都有 `tenant_id` | 一般 | 低 | 中小客户/免费版 |

在 Laravel 中，**共享表 + 租户ID列** 是最常见的方案，因为它成本最低且与 Laravel 的 Eloquent ORM 天然兼容。核心思路是：**所有涉及业务数据的表都包含 `tenant_id` 字段，并通过全局作用域确保查询自动附加租户过滤条件。**

```php
// app/Models/Concerns/BelongsToTenant.php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    protected static function bootBelongsToTenant(): void
    {
        // 自动设置 tenant_id
        static::creating(function ($model) {
            if (!$model->tenant_id && app()->bound('current_tenant')) {
                $model->tenant_id = app('current_tenant')->id;
            }
        });

        // 全局作用域：自动过滤当前租户数据
        static::addGlobalScope('tenant', function (Builder $builder) {
            if (app()->bound('current_tenant')) {
                $builder->where('tenant_id', app('current_tenant')->id);
            }
        });
    }

    public function tenant()
    {
        return $this->belongsTo(\App\Models\Tenant::class);
    }
}
```

使用方式非常简单：

```php
// app/Models/Agent.php
use App\Models\Concerns\BelongsToTenant;

class Agent extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'name', 'description', 'system_prompt',
        'model_config', 'tools_config', 'knowledge_base_ids',
        'is_active',
    ];

    protected $casts = [
        'model_config'     => 'array',
        'tools_config'     => 'array',
        'knowledge_base_ids' => 'array',
    ];
}
```

有了 `BelongsToTenant` trait，所有的 Agent 查询都会自动带上 `WHERE tenant_id = ?` 条件，开发者无需手动添加，极大降低了数据泄露的风险。

**但这里有三个关键注意事项：**

**第一，跨租户查询场景。** 管理后台、统计报表、系统运维等场景需要绕过全局作用域。Laravel 提供了 `withoutGlobalScope` 方法：

```php
// 仅限管理后台内部使用
$allAgents = Agent::withoutGlobalScope('tenant')->count();
// 按租户统计 Agent 数量
$stats = Agent::withoutGlobalScope('tenant')
    ->select('tenant_id', DB::raw('COUNT(*) as agent_count'))
    ->groupBy('tenant_id')
    ->get();
```

**第二，批量操作的陷阱。** 当使用 `Model::where(...)->update(...)` 等批量操作时，Eloquent 的全局作用域确实会被应用。但如果你直接使用 `DB::table()`，则不会受到全局作用域的影响——这是一个常见的数据泄露漏洞。

```php
// ✅ 安全：经过全局作用域
Agent::where('is_active', false)->update(['status' => 'archived']);

// ⚠️ 危险：绕过全局作用域，可能影响其他租户数据！
DB::table('agents')->where('is_active', false)->update(['status' => 'archived']);
```

**第三，数据库连接和迁移。** 如果采用独立数据库模式，需要动态切换数据库连接：

```php
// config/database.php 中动态设置
config()->set('database.connections.tenant.database', $tenant->db_name);

// 或者在中间件中切换
DB::purge('tenant');
config()->set('database.connections.tenant.database', $tenant->database);
DB::reconnect('tenant');
```

### 2.2 缓存隔离

Redis 是 AI Agent 系统中使用最频繁的缓存层——存储会话状态、Rate Limit 计数器、模型响应缓存、Prompt 缓存等。缓存隔离的基本原则是**为所有 Key 加上租户前缀**。

```php
// app/Services/TenantCache.php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class TenantCache
{
    private int $tenantId;

    public function __construct()
    {
        $this->tenantId = app('current_tenant')->id;
    }

    /**
     * 生成带租户前缀的 Key
     */
    private function key(string $key): string
    {
        return "t:{$this->tenantId}:{$key}";
    }

    public function get(string $key)
    {
        return Redis::get($this->key($key));
    }

    public function set(string $key, $value, int $ttl = 3600)
    {
        Redis::setex($this->key($key), $ttl, serialize($value));
    }

    public function increment(string $key, int $amount = 1): int
    {
        return Redis::incrby($this->key($key), $amount);
    }

    public function remember(string $key, int $ttl, callable $callback)
    {
        $cached = $this->get($key);
        if ($cached !== null) {
            return unserialize($cached);
        }
        $value = $callback();
        $this->set($key, $value, $ttl);
        return $value;
    }

    /**
     * 清除该租户的所有缓存（谨慎使用）
     */
    public function flushAll(): void
    {
        $pattern = "t:{$this->tenantId}:*";
        $keys = Redis::keys($pattern);
        if (!empty($keys)) {
            Redis::del($keys);
        }
    }
}
```

对于 Rate Limit，Laravel 内置的 `RateLimiter` 天然支持自定义 Key，我们可以结合租户 ID 来实现：

```php
// app/Providers/AppServiceProvider.php

use Illuminate\Support\Facades\RateLimiter;

public function boot(): void
{
    RateLimiter::for('agent-request', function (Request $request) {
        $tenant = app('current_tenant');
        $config = $tenant->getRateLimitConfig();

        return Limit::perMinute($config['requests_per_minute'])
            ->key('agent:' . $tenant->id)
            ->response(function (Request $request, $headers) {
                return response()->json([
                    'error' => 'rate_limit_exceeded',
                    'message' => '请求过于频繁，请稍后再试',
                    'retry_after' => $headers->get('Retry-After'),
                ], 429);
            });
    });
}
```

### 2.3 向量数据库隔离

在 AI Agent 场景中，RAG（Retrieval-Augmented Generation）是最核心的能力之一。每个租户的知识库数据通过 Embedding 向量化后存储在向量数据库（如 Pinecone、Milvus、Qdrant、Weaviate 等）中。向量数据库的隔离方式主要有三种：

**方案一：按租户创建独立 Collection/Namespace（推荐）**

大多数向量数据库都支持 Namespace 或 Collection 的概念，为每个租户创建独立的命名空间是最干净的隔离方式：

```php
// app/Services/VectorStore/PineconeVectorStore.php

namespace App\Services\VectorStore;

class PineconeVectorStore
{
    private string $apiKey;
    private string $indexHost;

    public function __construct()
    {
        $this->apiKey = config('services.pinecone.api_key');
        $this->indexHost = config('services.pinecone.index_host');
    }

    /**
     * 在向量存储中使用租户 ID 作为 Namespace
     */
    private function namespace(): string
    {
        return 'tenant_' . app('current_tenant')->id;
    }

    /**
     * 存储向量
     */
    public function upsert(array $vectors): void
    {
        $client = new \GuzzleHttp\Client();

        $client->post("{$this->indexHost}/vectors/upsert", [
            'headers' => [
                'Api-Key' => $this->apiKey,
                'Content-Type' => 'application/json',
            ],
            'json' => [
                'namespace' => $this->namespace(),
                'vectors'   => $vectors,
            ],
        ]);
    }

    /**
     * 查询相似向量
     */
    public function query(array $embedding, int $topK = 5): array
    {
        $client = new \GuzzleHttp\Client();

        $response = $client->post("{$this->indexHost}/query", [
            'headers' => [
                'Api-Key' => $this->apiKey,
                'Content-Type' => 'application/json',
            ],
            'json' => [
                'namespace'   => $this->namespace(),
                'vector'      => $embedding,
                'topK'        => $topK,
                'includeMetadata' => true,
            ],
        ]);

        return json_decode($response->getBody(), true)['matches'] ?? [];
    }

    /**
     * 删除该租户某个知识库的所有向量
     */
    public function deleteByKnowledgeBase(string $kbId): void
    {
        $client = new \GuzzleHttp\Client();

        $client->post("{$this->indexHost}/vectors/delete", [
            'headers' => [
                'Api-Key' => $this->apiKey,
                'Content-Type' => 'application/json',
            ],
            'json' => [
                'namespace' => $this->namespace(),
                'filter' => [
                    'knowledge_base_id' => ['$eq' => $kbId],
                ],
            ],
        ]);
    }
}
```

**方案二：共享 Collection，元数据过滤**

如果向量数据库不支持 Namespace 或成本过高，可以将所有租户的向量存在同一集合中，但每条记录都携带 `tenant_id` 元数据，在查询时通过 Metadata Filter 来过滤：

```php
public function queryWithFilter(array $embedding, int $topK = 5): array
{
    return $this->query([
        'vector' => $embedding,
        'topK' => $topK,
        'filter' => [
            'tenant_id' => ['$eq' => app('current_tenant')->id],
        ],
        'includeMetadata' => true,
    ]);
}
```

这种方式的风险在于：如果代码中遗漏了 `tenant_id` 过滤条件，就会导致跨租户数据泄露。因此必须在底层封装中强制附加过滤条件，而非依赖上层调用者手动添加。

**方案三：独立数据库实例**

对于数据安全要求极高的企业客户（如金融、医疗行业），为每个租户部署独立的向量数据库实例是最安全的方案，但成本也最高。这种方式通常与独立数据库模式搭配使用。

---

## 三、按租户路由 LLM 调用

### 3.1 为什么需要按租户路由？

不同租户对 LLM 的需求差异巨大：

- **模型偏好**：A 客户要求使用 GPT-4o，B 客户因成本考虑选择 Claude 3.5 Sonnet，C 客户出于数据合规要求必须使用私有部署的 Llama 3
- **供应商管理**：不同租户可能使用不同的 API Key（客户的自备 Key 或平台分配的 Key）
- **成本控制**：免费版使用低配模型，企业版使用高配模型
- **合规要求**：某些租户的数据必须路由到特定区域的 API 端点（如欧洲数据路由到欧盟区的 OpenAI 端点）

因此，**LLM 调用的路由必须是租户级别的、可配置的、可动态切换的**。

### 3.2 LLM Router 设计

```php
// app/Services/LlmRouter.php

namespace App\Services;

use App\Models\Tenant;
use App\Exceptions\ModelNotAllowedException;

class LlmRouter
{
    private Tenant $tenant;

    public function __construct()
    {
        $this->tenant = app('current_tenant');
    }

    /**
     * 根据租户配置解析出最终的 LLM 调用参数
     */
    public function resolve(?string $requestedModel = null): array
    {
        $config = $this->tenant->getLlmConfig();

        // 1. 确定使用的模型
        $model = $requestedModel ?? $config['default_model'];

        // 2. 校验该租户是否有权限使用该模型
        if (!in_array($model, $config['allowed_models'])) {
            throw new ModelNotAllowedException(
                "当前套餐不支持使用 {$model} 模型，请升级套餐或选择其他模型"
            );
        }

        // 3. 确定 API 端点和密钥
        $endpoint = $this->resolveEndpoint($model);
        $apiKey = $this->resolveApiKey($model);

        // 4. 确定模型参数
        $params = [
            'temperature'   => $config['temperature'] ?? 0.7,
            'max_tokens'    => $config['max_tokens'] ?? 4096,
            'top_p'         => $config['top_p'] ?? 1.0,
        ];

        return [
            'model'      => $model,
            'endpoint'   => $endpoint,
            'api_key'    => $apiKey,
            'params'     => $params,
            'fallback'   => $config['fallback_model'] ?? null,
        ];
    }

    /**
     * 根据模型名称解析 API 端点
     */
    private function resolveEndpoint(string $model): string
    {
        // 支持租户自定义端点（如私有部署场景）
        $customEndpoints = $this->tenant->llm_config['custom_endpoints'] ?? [];

        if (isset($customEndpoints[$model])) {
            return $customEndpoints[$model];
        }

        // 默认供应商端点映射
        return match(true) {
            str_starts_with($model, 'gpt')       => config('services.openai.api_url'),
            str_starts_with($model, 'claude')     => config('services.anthropic.api_url'),
            str_starts_with($model, 'deepseek')   => config('services.deepseek.api_url'),
            default                                => config('services.openai.api_url'),
        };
    }

    /**
     * 解析 API Key：优先使用租户自备 Key，否则使用平台统一 Key
     */
    private function resolveApiKey(string $model): string
    {
        $tenantKeys = $this->tenant->llm_config['api_keys'] ?? [];

        // 租户自备 Key
        if (isset($tenantKeys[$model])) {
            return $tenantKeys[$model];
        }

        // 按供应商查找
        $provider = $this->detectProvider($model);
        if (isset($tenantKeys[$provider])) {
            return $tenantKeys[$provider];
        }

        // 使用平台统一 Key
        return match($provider) {
            'openai'    => config('services.openai.api_key'),
            'anthropic' => config('services.anthropic.api_key'),
            'deepseek'  => config('services.deepseek.api_key'),
            default     => config('services.openai.api_key'),
        };
    }

    private function detectProvider(string $model): string
    {
        return match(true) {
            str_starts_with($model, 'gpt')       => 'openai',
            str_starts_with($model, 'claude')     => 'anthropic',
            str_starts_with($model, 'deepseek')   => 'deepseek',
            default                                => 'openai',
        };
    }
}
```

### 3.3 Failover（故障转移）机制

LLM API 的稳定性是 SaaS 平台的命脉。单个供应商的 API 故障、限流、延迟飙升都可能导致整租户的 Agent 不可用。因此，**每个租户都需要配置 Failover 策略**。

```php
// app/Services/LlmClient.php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class LlmClient
{
    private LlmRouter $router;

    public function __construct(LlmRouter $router)
    {
        $this->router = $router;
    }

    /**
     * 发送 LLM 请求，内置 Failover 和重试逻辑
     */
    public function chat(array $messages, array $options = []): array
    {
        $config = $this->router->resolve($options['model'] ?? null);
        $maxRetries = $options['max_retries'] ?? 2;

        $modelsToTry = [$config['model']];
        if ($config['fallback']) {
            $modelsToTry[] = $config['fallback'];
        }

        $lastException = null;

        foreach ($modelsToTry as $model) {
            for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
                try {
                    $result = $this->callProvider($model, $messages, $config, $options);

                    // 记录成功调用
                    $this->recordUsage($model, $result);

                    return $result;
                } catch (LlmRateLimitException $e) {
                    // 限流错误，等待后重试
                    $waitTime = pow(2, $attempt) * 100; // 指数退避
                    usleep($waitTime * 1000);
                    $lastException = $e;
                    Log::warning("LLM rate limit hit", [
                        'tenant_id' => app('current_tenant')->id,
                        'model' => $model,
                        'attempt' => $attempt,
                    ]);
                } catch (LlmApiException $e) {
                    // API 错误，切换到备用模型
                    Log::error("LLM API error, trying fallback", [
                        'tenant_id' => app('current_tenant')->id,
                        'model' => $model,
                        'error' => $e->getMessage(),
                    ]);
                    $lastException = $e;
                    break; // 跳出重试循环，尝试下一个模型
                }
            }
        }

        throw new LlmException(
            "所有模型调用均失败: " . $lastException->getMessage(),
            0,
            $lastException
        );
    }

    /**
     * 流式调用（SSE）
     */
    public function chatStream(array $messages, array $options = []): \Generator
    {
        $config = $this->router->resolve($options['model'] ?? null);
        $tenantId = app('current_tenant')->id;
        $totalTokens = 0;

        $stream = $this->callProviderStream(
            $config['model'], $messages, $config, $options
        );

        foreach ($stream as $chunk) {
            $delta = $chunk['choices'][0]['delta']['content'] ?? '';
            $usage = $chunk['usage'] ?? null;

            if ($usage) {
                $totalTokens = $usage['total_tokens'];
            }

            yield $chunk;
        }

        // 流结束后记录用量
        if ($totalTokens > 0) {
            $this->recordUsage($config['model'], [
                'usage' => ['total_tokens' => $totalTokens],
            ]);
        }
    }

    private function callProvider(string $model, array $messages, array $config, array $options): array
    {
        $client = new \GuzzleHttp\Client([
            'timeout' => $options['timeout'] ?? 60,
        ]);

        $provider = $this->router->detectProvider($model);

        $response = $client->post($config['endpoint'], [
            'headers' => [
                'Authorization' => 'Bearer ' . $config['api_key'],
                'Content-Type'  => 'application/json',
            ],
            'json' => array_merge($config['params'], [
                'model'    => $model,
                'messages' => $messages,
            ], $options['extra'] ?? []),
        ]);

        $result = json_decode($response->getBody(), true);

        if (isset($result['error'])) {
            throw new LlmApiException($result['error']['message']);
        }

        return $result;
    }

    private function recordUsage(string $model, array $result): void
    {
        $tenantId = app('current_tenant')->id;
        $usage = $result['usage'] ?? [];

        // 异步记录用量，不阻塞主流程
        dispatch(new \App\Jobs\RecordLlmUsageJob(
            tenantId: $tenantId,
            model: $model,
            promptTokens: $usage['prompt_tokens'] ?? 0,
            completionTokens: $usage['completion_tokens'] ?? 0,
            totalTokens: $usage['total_tokens'] ?? 0,
        ));
    }
}
```

### 3.4 模型检测与自动路由

在某些场景下，我们希望根据用户查询的复杂度自动选择模型——简单问题用便宜模型，复杂问题用高级模型。这种智能路由可以为租户节省大量成本。

```php
// app/Services/SmartModelRouter.php

namespace App\Services;

class SmartModelRouter
{
    /**
     * 根据查询复杂度选择模型
     */
    public function selectModel(string $query, array $context = []): string
    {
        $complexity = $this->estimateComplexity($query, $context);
        $tenant = app('current_tenant');
        $config = $tenant->getLlmConfig();

        return match(true) {
            $complexity < 0.3 => $config['simple_model'] ?? 'gpt-4o-mini',
            $complexity < 0.7 => $config['default_model'],
            default           => $config['advanced_model'] ?? 'gpt-4o',
        };
    }

    private function estimateComplexity(string $query, array $context): float
    {
        $score = 0.0;

        // 1. 查询长度
        $length = mb_strlen($query);
        $score += min($length / 500, 0.3);

        // 2. 是否涉及推理
        $reasoningKeywords = ['为什么', '分析', '对比', '总结', '评估', '方案', 'why', 'analyze', 'compare'];
        foreach ($reasoningKeywords as $keyword) {
            if (str_contains(mb_strtolower($query), $keyword)) {
                $score += 0.15;
                break;
            }
        }

        // 3. 上下文长度（RAG 检索到的文档越多，问题越复杂）
        $contextLength = collect($context)->sum(fn($doc) => mb_strlen($doc['content'] ?? ''));
        $score += min($contextLength / 5000, 0.3);

        return min($score, 1.0);
    }
}
```

---

## 四、用量计量与计费

### 4.1 计量的核心指标

在多租户 AI Agent 平台中，需要计量的核心指标包括：

| 指标 | 说明 | 计费方式 |
|------|------|----------|
| Token 消耗 | Prompt + Completion 的 Token 总量 | 按量计费 |
| API 调用次数 | Agent 对话请求次数 | 按次计费 / 包含在配额内 |
| 知识库存储量 | 向量数据 + 源文件大小 | 按存储量计费 |
| Agent 数量 | 该租户创建的 Agent 数量 | 包含在套餐内 |
| 工具调用次数 | Agent 调用外部工具/API 的次数 | 按次计费 |
| 会话时长 | 交互式会话的持续时间 | 按时长计费 |

### 4.2 UsageRecord 模型设计

```php
// database/migrations/xxxx_create_usage_records_table.php

Schema::create('usage_records', function (Blueprint $table) {
    $table->id();
    $table->foreignId('tenant_id')->constrained()->onDelete('cascade');
    $table->foreignId('agent_id')->nullable()->constrained()->nullOnDelete();
    $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();

    // 用量类型
    $table->string('type', 50)->index(); // llm_call, embedding, tool_call, storage

    // LLM 相关
    $table->string('model')->nullable();
    $table->unsignedInteger('prompt_tokens')->default(0);
    $table->unsignedInteger('completion_tokens')->default(0);
    $table->unsignedInteger('total_tokens')->default(0);

    // 成本（以分为单位，避免浮点精度问题）
    $table->unsignedInteger('cost_cents')->default(0);
    $table->string('currency', 3)->default('USD');

    // 元数据
    $table->json('metadata')->nullable();

    // 时间索引（用于按月/按日统计）
    $table->date('recorded_date')->index();
    $table->timestamp('recorded_at')->useCurrent();

    $table->index(['tenant_id', 'type', 'recorded_date']);
    $table->index(['tenant_id', 'recorded_at']);
});
```

### 4.3 用量记录服务

```php
// app/Services/UsageTracker.php

namespace App\Services;

use App\Models\UsageRecord;
use App\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UsageTracker
{
    /**
     * 记录 LLM 调用用量
     */
    public function recordLlmUsage(
        int $tenantId,
        string $model,
        int $promptTokens,
        int $completionTokens,
        ?int $agentId = null,
        ?int $conversationId = null,
        array $metadata = []
    ): void {
        $totalTokens = $promptTokens + $completionTokens;
        $costCents = $this->calculateCost($model, $promptTokens, $completionTokens);
        $today = now()->toDateString();

        // 1. 持久化记录（用于计费账单）
        UsageRecord::create([
            'tenant_id'         => $tenantId,
            'agent_id'          => $agentId,
            'conversation_id'   => $conversationId,
            'type'              => 'llm_call',
            'model'             => $model,
            'prompt_tokens'     => $promptTokens,
            'completion_tokens' => $completionTokens,
            'total_tokens'      => $totalTokens,
            'cost_cents'        => $costCents,
            'metadata'          => $metadata,
            'recorded_date'     => $today,
        ]);

        // 2. 更新 Redis 中的实时计数器（用于 Rate Limit 和配额检查）
        $redis = app(TenantCache::class);

        // 日累计
        $redis->increment("usage:tokens:daily:{$today}", $totalTokens);
        // 月累计
        $monthKey = now()->format('Y-m');
        $redis->increment("usage:tokens:monthly:{$monthKey}", $totalTokens);
        // 日调用次数
        $redis->increment("usage:calls:daily:{$today}");
        // 总成本（分）
        $redis->increment("usage:cost_cents:monthly:{$monthKey}", $costCents);
    }

    /**
     * 根据模型和 Token 数量计算成本（单位：美分）
     */
    private function calculateCost(string $model, int $promptTokens, int $completionTokens): int
    {
        // 价格表（每百万 Token 的价格，单位美分）
        $pricing = [
            'gpt-4o'           => ['input' => 250,  'output' => 1000],
            'gpt-4o-mini'      => ['input' => 15,   'output' => 60],
            'gpt-3.5-turbo'    => ['input' => 5,    'output' => 15],
            'claude-3.5-sonnet' => ['input' => 300, 'output' => 1500],
            'claude-3-haiku'   => ['input' => 25,   'output' => 125],
            'deepseek-chat'    => ['input' => 14,   'output' => 28],
        ];

        $modelPricing = $pricing[$model] ?? ['input' => 100, 'output' => 100];

        $inputCost = ($promptTokens / 1000000) * $modelPricing['input'];
        $outputCost = ($completionTokens / 1000000) * $modelPricing['output'];

        return (int) round(($inputCost + $outputCost) * 100); // 转为美分
    }

    /**
     * 检查租户是否超出月度配额
     */
    public function checkQuota(Tenant $tenant): array
    {
        $config = $tenant->getLlmConfig();
        $config2 = $tenant->getRateLimitConfig();
        $monthKey = now()->format('Y-m');

        $redis = app(TenantCache::class);

        $usedTokens = (int) $redis->get("usage:tokens:monthly:{$monthKey}");
        $quota = $config['monthly_token_quota'] ?? 1000000;
        $remaining = max(0, $quota - $usedTokens);

        $isOverQuota = $remaining <= 0;
        $usagePercent = $quota > 0 ? round(($usedTokens / $quota) * 100, 1) : 100;

        return [
            'used_tokens'      => $usedTokens,
            'quota'            => $quota,
            'remaining'        => $remaining,
            'usage_percent'    => $usagePercent,
            'is_over_quota'    => $isOverQuota,
            'warning'          => $usagePercent >= 80 ? '已使用超过80%的月度配额' : null,
        ];
    }

    /**
     * 生成租户月度账单摘要
     */
    public function generateMonthlyBill(int $tenantId, string $month): array
    {
        $records = UsageRecord::where('tenant_id', $tenantId)
            ->where('recorded_date', 'like', "{$month}-%")
            ->selectRaw('
                type,
                model,
                COUNT(*) as call_count,
                SUM(prompt_tokens) as total_prompt_tokens,
                SUM(completion_tokens) as total_completion_tokens,
                SUM(total_tokens) as total_tokens,
                SUM(cost_cents) as total_cost_cents
            ')
            ->groupBy('type', 'model')
            ->get();

        $totalCostCents = $records->sum('total_cost_cents');

        return [
            'month'        => $month,
            'tenant_id'    => $tenantId,
            'items'        => $records->toArray(),
            'total_cost'   => [
                'cents'    => $totalCostCents,
                'dollars'  => number_format($totalCostCents / 100, 2),
            ],
        ];
    }
}
```

### 4.4 异步记录避免性能损耗

用量记录不应阻塞 Agent 的正常响应。在高并发场景下，同步写入数据库会成为性能瓶颈。我们使用 Laravel 队列来异步处理：

```php
// app/Jobs/RecordLlmUsageJob.php

namespace App\Jobs;

use App\Services\UsageTracker;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RecordLlmUsageJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(
        public int    $tenantId,
        public string $model,
        public int    $promptTokens,
        public int    $completionTokens,
        public ?int   $agentId = null,
        public ?int   $conversationId = null,
    ) {}

    public function handle(UsageTracker $tracker): void
    {
        $tracker->recordLlmUsage(
            tenantId: $this->tenantId,
            model: $this->model,
            promptTokens: $this->promptTokens,
            completionTokens: $this->completionTokens,
            agentId: $this->agentId,
            conversationId: $this->conversationId,
        );
    }
}
```

**关键设计要点：**

- Redis 中的实时计数器必须**同步更新**（用于即时 Rate Limit 检查）
- 数据库中的详细记录可以**异步写入**（用于账单和分析）
- 这种"同步计数 + 异步持久化"的模式在高并发计量场景中非常常见

---

## 五、Rate Limiting 策略

### 5.1 多维度限流

AI Agent 平台的 Rate Limiting 比传统 Web API 更加复杂，因为需要同时考虑多个维度：

```php
// app/Services/TenantRateLimiter.php

namespace App\Services;

use App\Models\Tenant;
use Illuminate\Http\Request;

class TenantRateLimiter
{
    private Tenant $tenant;
    private TenantCache $cache;

    public function __construct()
    {
        $this->tenant = app('current_tenant');
        $this->cache = app(TenantCache::class);
    }

    /**
     * 综合检查所有限流维度
     *
     * @return array ['allowed' => bool, 'reason' => string|null, 'retry_after' => int|null]
     */
    public function check(string $agentId = null): array
    {
        $config = $this->tenant->getRateLimitConfig();

        // 1. 每分钟请求数限制
        $minuteKey = 'rl:requests:min:' . now()->format('Hi');
        $minuteCount = (int) $this->cache->get($minuteKey) ?: 0;
        if ($minuteCount >= $config['requests_per_minute']) {
            return [
                'allowed'     => false,
                'reason'      => '每分钟请求次数已达上限',
                'retry_after' => 60 - now()->second,
            ];
        }

        // 2. 并发请求数限制
        $concurrentKey = 'rl:concurrent';
        $concurrentCount = (int) $this->cache->get($concurrentKey) ?: 0;
        if ($concurrentCount >= $config['concurrent_requests']) {
            return [
                'allowed'     => false,
                'reason'      => '并发请求数已达上限',
                'retry_after' => 5,
            ];
        }

        // 3. 每分钟 Token 消耗限制
        $tokenKey = 'rl:tokens:min:' . now()->format('Hi');
        $tokenCount = (int) $this->cache->get($tokenKey) ?: 0;
        if ($tokenCount >= $config['tokens_per_minute']) {
            return [
                'allowed'     => false,
                'reason'      => '每分钟 Token 消耗已达上限',
                'retry_after' => 60 - now()->second,
            ];
        }

        // 4. 月度配额检查
        $quotaService = app(\App\Services\UsageTracker::class);
        $quota = $quotaService->checkQuota($this->tenant);
        if ($quota['is_over_quota']) {
            return [
                'allowed'     => false,
                'reason'      => '月度 Token 配额已耗尽，请升级套餐或等待下月重置',
                'retry_after' => null,
            ];
        }

        return ['allowed' => true, 'reason' => null, 'retry_after' => null];
    }

    /**
     * 请求开始时标记
     */
    public function acquire(string $agentId = null): void
    {
        $minuteKey = 'rl:requests:min:' . now()->format('Hi');
        $this->cache->increment($minuteKey);
        $this->cache->set($minuteKey, $this->cache->get($minuteKey) ?: 1, 120);

        $this->cache->increment('rl:concurrent');
    }

    /**
     * 请求结束时释放
     */
    public function release(): void
    {
        $concurrent = max(0, (int) $this->cache->get('rl:concurrent') - 1);
        $this->cache->set('rl:concurrent', $concurrent);
    }
}
```

### 5.2 在中间件中集成限流

```php
// app/Http/Middleware/TenantRateLimit.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\TenantRateLimiter;

class TenantRateLimit
{
    public function __construct(private TenantRateLimiter $limiter) {}

    public function handle(Request $request, Closure $next)
    {
        $check = $this->limiter->check();

        if (!$check['allowed']) {
            $response = response()->json([
                'error'   => 'rate_limit_exceeded',
                'message' => $check['reason'],
            ], 429);

            if ($check['retry_after']) {
                $response->header('Retry-After', $check['retry_after']);
                $response->header('X-RateLimit-Reset', now()->addSeconds($check['retry_after'])->timestamp);
            }

            return $response;
        }

        // 标记请求开始
        $this->limiter->acquire();

        $response = $next($request);

        // 释放并发计数
        $this->limiter->release();

        return $response;
    }
}
```

### 5.3 配额预警与自动降级

当租户接近配额上限时，应该提前预警，而不是突然中断服务。同时，在配额耗尽时，可以提供自动降级策略：

```php
// app/Services/QuotaGuard.php

namespace App\Services;

use App\Models\Tenant;
use Illuminate\Support\Facades\Notification;
use App\Notifications\QuotaWarningNotification;

class QuotaGuard
{
    public function handle(Tenant $tenant, callable $next): mixed
    {
        $tracker = app(UsageTracker::class);
        $quota = $tracker->checkQuota($tenant);

        // 1. 配额耗尽处理
        if ($quota['is_over_quota']) {
            // 企业版可以允许超额使用，后续计费
            if ($tenant->plan === 'enterprise') {
                return $next(); // 允许继续，但标记为超额
            }

            // 其他套餐返回错误
            return response()->json([
                'error'   => 'quota_exceeded',
                'message' => '本月 Token 配额已耗尽，请升级套餐',
                'upgrade_url' => '/dashboard/billing',
            ], 402); // 402 Payment Required
        }

        // 2. 预警通知（使用 Cache 避免重复发送）
        if ($quota['usage_percent'] >= 80) {
            $warnKey = "quota_warning_sent:{$tenant->id}:" . now()->format('Y-m');
            if (!cache()->has($warnKey)) {
                // 异步发送预警通知
                Notification::route('mail', $tenant->billing_email)
                    ->notify(new QuotaWarningNotification($tenant, $quota));

                // 标记已发送，30天内不重复
                cache()->put($warnKey, true, now()->addDays(30));
            }
        }

        // 3. 接近上限时自动降级模型
        if ($quota['usage_percent'] >= 90) {
            // 强制使用低成本模型
            $config = $tenant->getLlmConfig();
            app('current_tenant')->llm_config = array_merge($config, [
                'default_model' => $config['fallback_model'] ?? 'gpt-4o-mini',
                'auto_downgraded' => true,
            ]);
        }

        return $next();
    }
}
```

---

## 六、Agent 配置隔离

### 6.1 Agent 模型与配置存储

每个租户可以创建多个 Agent，每个 Agent 有独立的系统提示词、模型配置、工具集和知识库关联。Agent 的配置是多层嵌套的——租户级默认配置 → Agent 级配置 → 会话级临时配置。

```php
// app/Models/Agent.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Models\Concerns\BelongsToTenant;

class Agent extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'name',
        'slug',
        'description',
        'system_prompt',        // 系统提示词
        'model_override',       // JSON: 覆盖租户级模型配置
        'tools_config',         // JSON: 工具配置
        'knowledge_base_ids',   // JSON: 关联的知识库 ID 列表
        'rag_config',           // JSON: RAG 检索配置
        'memory_config',        // JSON: 会话记忆配置
        'guardrails_config',    // JSON: 安全防护配置
        'is_active',
        'version',              // 配置版本号，支持回滚
    ];

    protected $casts = [
        'model_override'     => 'array',
        'tools_config'       => 'array',
        'knowledge_base_ids' => 'array',
        'rag_config'         => 'array',
        'memory_config'      => 'array',
        'guardrails_config'  => 'array',
        'is_active'          => 'boolean',
    ];

    /**
     * 获取合并后的最终配置（租户默认 → Agent 覆盖）
     */
    public function getResolvedConfig(): array
    {
        $tenantConfig = $this->tenant->getLlmConfig();
        $agentOverride = $this->model_override ?? [];

        return array_merge($tenantConfig, $agentOverride);
    }

    /**
     * 版本化配置变更
     */
    public function updateConfig(array $newConfig): void
    {
        // 保存历史版本
        $this->configVersions()->create([
            'config_snapshot' => $this->only([
                'system_prompt', 'model_override', 'tools_config',
                'knowledge_base_ids', 'rag_config', 'memory_config',
                'guardrails_config',
            ]),
            'version' => $this->version,
        ]);

        // 应用新配置
        $this->update(array_merge($newConfig, [
            'version' => $this->version + 1,
        ]));
    }

    public function configVersions()
    {
        return $this->hasMany(AgentConfigVersion::class);
    }

    public function knowledgeBases()
    {
        return $this->belongsToMany(
            KnowledgeBase::class,
            'agent_knowledge_base'
        );
    }
}
```

### 6.2 Agent 执行引擎

Agent 的核心执行逻辑需要在 LLM 调用、工具执行、RAG 检索之间协调运作。以下是一个简化的 Agent 执行引擎：

```php
// app/Services/AgentExecutor.php

namespace App\Services;

use App\Models\Agent;
use App\Models\Conversation;
use Illuminate\Support\Facades\Log;

class AgentExecutor
{
    public function __construct(
        private LlmClient $llm,
        private TenantRateLimiter $rateLimiter,
        private VectorStore $vectorStore,
        private ToolRegistry $toolRegistry,
    ) {}

    /**
     * 执行 Agent 对话
     */
    public function execute(
        Agent $agent,
        Conversation $conversation,
        string $userMessage,
        array $options = []
    ): array {
        $tenant = app('current_tenant');

        // 1. 构建消息上下文
        $messages = $this->buildMessages($agent, $conversation, $userMessage);

        // 2. RAG 检索增强
        if ($agent->knowledge_base_ids && !empty($agent->knowledge_base_ids)) {
            $ragResults = $this->performRagSearch($agent, $userMessage);
            $messages = $this->injectRagContext($messages, $ragResults);
        }

        // 3. 注入工具描述
        $tools = $this->toolRegistry->getToolsForAgent($agent);

        // 4. LLM 调用（可能涉及多轮工具调用循环）
        $result = $this->agentLoop($agent, $messages, $tools, $options);

        // 5. 保存会话消息
        $conversation->messages()->create([
            'role'    => 'user',
            'content' => $userMessage,
        ]);
        $conversation->messages()->create([
            'role'      => 'assistant',
            'content'   => $result['content'],
            'metadata'  => [
                'model'     => $result['model'],
                'tokens'    => $result['usage'],
                'tool_calls' => $result['tool_calls'] ?? [],
            ],
        ]);

        return $result;
    }

    /**
     * Agent 循环：LLM 调用 → 工具执行 → 再次调用 LLM，直到得到最终回复
     */
    private function agentLoop(Agent $agent, array $messages, array $tools, array $options): array
    {
        $maxIterations = $options['max_tool_rounds'] ?? 5;
        $iteration = 0;
        $allToolCalls = [];

        while ($iteration < $maxIterations) {
            $iteration++;

            // 调用 LLM
            $llmResponse = $this->llm->chat($messages, array_merge(
                $agent->getResolvedConfig(),
                ['extra' => ['tools' => $tools]]
            ));

            $choice = $llmResponse['choices'][0] ?? null;
            if (!$choice) {
                throw new \RuntimeException('LLM 返回空结果');
            }

            $assistantMessage = $choice['message'];

            // 如果没有工具调用，直接返回
            if (empty($assistantMessage['tool_calls'] ?? [])) {
                return [
                    'content'    => $assistantMessage['content'] ?? '',
                    'model'      => $llmResponse['model'],
                    'usage'      => $llmResponse['usage'] ?? [],
                    'tool_calls' => $allToolCalls,
                    'iterations' => $iteration,
                ];
            }

            // 执行工具调用
            $messages[] = $assistantMessage;

            foreach ($assistantMessage['tool_calls'] as $toolCall) {
                $toolResult = $this->executeToolCall($agent, $toolCall);
                $allToolCalls[] = [
                    'name'   => $toolCall['function']['name'],
                    'args'   => $toolCall['function']['arguments'],
                    'result' => $toolResult,
                ];

                $messages[] = [
                    'role'       => 'tool',
                    'tool_call_id' => $toolCall['id'],
                    'content'    => json_encode($toolResult),
                ];
            }
        }

        // 超过最大迭代次数，强制返回最后的 LLM 响应
        return [
            'content'    => $assistantMessage['content'] ?? '抱歉，处理过程过于复杂，请简化您的请求。',
            'model'      => $llmResponse['model'] ?? 'unknown',
            'usage'      => $llmResponse['usage'] ?? [],
            'tool_calls' => $allToolCalls,
            'iterations' => $iteration,
            'truncated'  => true,
        ];
    }

    /**
     * RAG 检索
     */
    private function performRagSearch(Agent $agent, string $query): array
    {
        $ragConfig = $agent->rag_config ?? [];
        $topK = $ragConfig['top_k'] ?? 5;
        $scoreThreshold = $ragConfig['score_threshold'] ?? 0.7;

        // 将查询文本转为向量
        $embedding = $this->getEmbedding($query);

        // 在关联的知识库中检索
        $results = [];
        foreach ($agent->knowledge_base_ids as $kbId) {
            $kbResults = $this->vectorStore->query(
                embedding: $embedding,
                topK: $topK,
                filter: ['knowledge_base_id' => $kbId]
            );
            $results = array_merge($results, $kbResults);
        }

        // 按分数排序并过滤
        usort($results, fn($a, $b) => $b['score'] <=> $a['score']);
        $results = array_filter($results, fn($r) => $r['score'] >= $scoreThreshold);

        return array_slice($results, 0, $topK);
    }

    /**
     * 将 RAG 检索结果注入消息上下文
     */
    private function injectRagContext(array $messages, array $ragResults): array
    {
        if (empty($ragResults)) {
            return $messages;
        }

        $contextText = "以下是从知识库中检索到的相关信息，请基于这些信息回答用户问题：\n\n";
        foreach ($ragResults as $i => $result) {
            $contextText .= "[参考 {$i + 1}] (来源: {$result['metadata']['source'] ?? '未知'}, "
                          . "相关度: " . round($result['score'] * 100) . "%)\n";
            $contextText .= $result['metadata']['text'] ?? $result['metadata']['content'] ?? '';
            $contextText .= "\n\n";
        }

        // 在系统提示词之后、用户消息之前插入上下文
        $systemIndex = collect($messages)->search(fn($m) => $m['role'] === 'system');
        if ($systemIndex !== false) {
            array_splice($messages, $systemIndex + 1, 0, [[
                'role'    => 'system',
                'content' => $contextText,
            ]]);
        } else {
            array_unshift($messages, [
                'role'    => 'system',
                'content' => $contextText,
            ]);
        }

        return $messages;
    }

    private function executeToolCall(Agent $agent, array $toolCall): mixed
    {
        $toolName = $toolCall['function']['name'];
        $arguments = json_decode($toolCall['function']['arguments'], true);

        $tool = $this->toolRegistry->get($toolName);
        if (!$tool) {
            return ['error' => "工具 {$toolName} 不存在"];
        }

        // 检查该 Agent 是否有权限使用该工具
        $allowedTools = $agent->tools_config['allowed'] ?? [];
        if (!empty($allowedTools) && !in_array($toolName, $allowedTools)) {
            return ['error' => "当前 Agent 无权使用 {$toolName} 工具"];
        }

        try {
            return $tool->execute($arguments, app('current_tenant'));
        } catch (\Throwable $e) {
            Log::error("Tool execution failed", [
                'tool'  => $toolName,
                'error' => $e->getMessage(),
                'tenant_id' => app('current_tenant')->id,
            ]);
            return ['error' => "工具执行失败: {$e->getMessage()}"];
        }
    }

    private function getEmbedding(string $text): array
    {
        $config = app('current_tenant')->getLlmConfig();
        $embeddingModel = $config['embedding_model'] ?? 'text-embedding-3-small';

        // 调用 Embedding API
        $client = new \GuzzleHttp\Client();
        $response = $client->post(config('services.openai.api_url') . '/embeddings', [
            'headers' => [
                'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                'Content-Type'  => 'application/json',
            ],
            'json' => [
                'model' => $embeddingModel,
                'input' => $text,
            ],
        ]);

        $result = json_decode($response->getBody(), true);

        return $result['data'][0]['embedding'] ?? [];
    }

    private function buildMessages(Agent $agent, Conversation $conversation, string $userMessage): array
    {
        $messages = [];

        // 系统提示词
        if ($agent->system_prompt) {
            $messages[] = [
                'role'    => 'system',
                'content' => $agent->system_prompt,
            ];
        }

        // 历史消息（根据 memory_config 控制窗口大小）
        $memoryConfig = $agent->memory_config ?? [];
        $windowSize = $memoryConfig['window_size'] ?? 20;

        $history = $conversation->messages()
            ->orderByDesc('id')
            ->limit($windowSize)
            ->get()
            ->reverse()
            ->values();

        foreach ($history as $msg) {
            $messages[] = [
                'role'    => $msg->role,
                'content' => $msg->content,
            ];
        }

        // 当前用户消息
        $messages[] = [
            'role'    => 'user',
            'content' => $userMessage,
        ];

        return $messages;
    }
}
```

### 6.3 Prompt 模板的安全隔离

Prompt 注入是 AI 应用中最严重的安全威胁之一。在多租户场景下，一个租户的恶意 Prompt 不应影响其他租户或平台本身。关键防护措施包括：

```php
// app/Services/PromptGuard.php

namespace App\Services;

class PromptGuard
{
    /**
     * 清洗用户输入，防止 Prompt 注入
     */
    public function sanitize(string $input): string
    {
        // 1. 移除系统级指令的伪装
        $dangerousPatterns = [
            '/(?i)ignore\s+(all\s+)?previous\s+instructions/i',
            '/(?i)forget\s+(all\s+)?previous/i',
            '/(?i)you\s+are\s+now\s+/i',
            '/(?i)system\s*:\s*/i',
            '/(?i)new\s+instructions?\s*:/i',
            '/<\|im_start\|>/',
            '/<\|im_end\|>/',
            '/\[INST\]/',
            '/\[\/INST\]/',
        ];

        $sanitized = $input;
        foreach ($dangerousPatterns as $pattern) {
            $sanitized = preg_replace($pattern, '[已过滤]', $sanitized);
        }

        // 2. 长度限制
        $maxLength = 10000;
        if (mb_strlen($sanitized) > $maxLength) {
            $sanitized = mb_substr($sanitized, 0, $maxLength);
        }

        return $sanitized;
    }

    /**
     * 检查 Agent 回复是否包含敏感信息泄露
     */
    public function checkResponseLeakage(string $response, array $context): array
    {
        $issues = [];

        // 检查是否泄露系统提示词
        $systemPrompt = $context['system_prompt'] ?? '';
        if ($systemPrompt && $this->containsSystemPromptLeak($response, $systemPrompt)) {
            $issues[] = 'response_leaks_system_prompt';
        }

        // 检查是否泄露 API Key 格式的数据
        if (preg_match('/sk-[a-zA-Z0-9]{20,}/', $response)) {
            $issues[] = 'response_contains_api_key';
        }

        return $issues;
    }

    private function containsSystemPromptLeak(string $response, string $systemPrompt): bool
    {
        // 提取系统提示词中的关键片段（>20字符的连续内容）
        $segments = array_filter(
            preg_split('/[\n.]/', $systemPrompt),
            fn($s) => mb_strlen(trim($s)) > 20
        );

        $matchCount = 0;
        foreach ($segments as $segment) {
            if (str_contains($response, trim($segment))) {
                $matchCount++;
            }
        }

        // 如果超过30%的系统提示词片段出现在回复中，判定为泄露
        return count($segments) > 0 && ($matchCount / count($segments)) > 0.3;
    }
}
```

---

## 七、安全性考量

### 7.1 API Key 安全

API Key 的安全是多租户系统的基石。以下是关键的安全实践：

```php
// app/Models/ApiKey.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ApiKey extends Model
{
    use \App\Models\Concerns\BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'name', 'key_hash', 'key_prefix',
        'scopes', 'is_active', 'expires_at', 'last_used_at',
    ];

    protected $casts = [
        'scopes'      => 'array',
        'is_active'   => 'boolean',
        'expires_at'  => 'datetime',
        'last_used_at' => 'datetime',
    ];

    /**
     * 生成新的 API Key（只返回一次，之后只存储哈希）
     */
    public static function generate(int $tenantId, string $name, array $scopes = []): array
    {
        $rawKey = 'sk-' . Str::random(48);
        $prefix = substr($rawKey, 0, 10); // sk-xxxxxxx

        $apiKey = static::create([
            'tenant_id'   => $tenantId,
            'name'        => $name,
            'key_hash'    => hash('sha256', $rawKey),
            'key_prefix'  => $prefix,
            'scopes'      => $scopes,
            'is_active'   => true,
        ]);

        return [
            'api_key'   => $rawKey,       // 仅在此处返回明文
            'key_id'    => $apiKey->id,
            'key_prefix' => $prefix,
        ];
    }
}
```

### 7.2 请求签名验证

对于高安全要求的场景，可以在 API Key 之上叠加请求签名验证：

```php
// app/Http/Middleware/VerifyRequestSignature.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class VerifyRequestSignature
{
    public function handle(Request $request, Closure $next)
    {
        $signature = $request->header('X-Signature');
        $timestamp = $request->header('X-Timestamp');

        if (!$signature || !$timestamp) {
            return response()->json(['error' => 'missing_signature'], 401);
        }

        // 检查时间戳（防重放攻击，5分钟有效期）
        if (abs(time() - (int)$timestamp) > 300) {
            return response()->json(['error' => 'request_expired'], 401);
        }

        // 验证签名
        $apiKey = app('current_api_key');
        $payload = $timestamp . $request->method() . $request->path() . $request->getContent();
        $expectedSignature = hash_hmac('sha256', $payload, $apiKey->signing_secret ?? '');

        if (!hash_equals($expectedSignature, $signature)) {
            return response()->json(['error' => 'invalid_signature'], 401);
        }

        return $next($request);
    }
}
```

### 7.3 数据加密

租户的敏感数据（如自备的 LLM API Key、知识库中的机密文档）需要加密存储：

```php
// app/Services/TenantEncryption.php

namespace App\Services;

use Illuminate\Support\Facades\Crypt;

class TenantEncryption
{
    /**
     * 使用租户级别的加密密钥加密数据
     * Laravel 的 Encrypter 使用 AES-256-CBC，对于高安全场景
     * 可以为每个租户使用独立的加密密钥
     */
    public static function encryptForTenant(int $tenantId, string $data): string
    {
        $key = self::getTenantKey($tenantId);
        return Crypt::encryptString($data);
        // 高安全方案：使用 $key 而非应用统一密钥
    }

    public static function decryptForTenant(int $tenantId, string $encrypted): string
    {
        return Crypt::decryptString($encrypted);
    }

    private static function getTenantKey(int $tenantId): string
    {
        // 从安全存储中获取租户密钥（如 Vault、AWS KMS 等）
        return cache()->remember("tenant_key:{$tenantId}", 3600, function () use ($tenantId) {
            $tenant = \App\Models\Tenant::withoutGlobalScopes()->find($tenantId);
            return $tenant->encryption_key ?? config('app.key');
        });
    }
}
```

### 7.4 审计日志

所有涉及数据访问、配置变更、管理操作的行为都应该记录审计日志：

```php
// app/Models/AuditLog.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $fillable = [
        'tenant_id',
        'user_id',
        'action',       // e.g. agent.created, config.updated, data.accessed
        'resource_type', // e.g. Agent, KnowledgeBase, ApiKey
        'resource_id',
        'changes',       // JSON: 变更前后对比
        'ip_address',
        'user_agent',
        'metadata',
    ];

    protected $casts = [
        'changes'  => 'array',
        'metadata' => 'array',
    ];

    /**
     * 记录审计事件
     */
    public static function log(
        string $action,
        string $resourceType = null,
        $resourceId = null,
        array $changes = [],
        array $metadata = []
    ): self {
        $request = request();

        return static::create([
            'tenant_id'     => app('current_tenant')?->id,
            'user_id'       => auth()->id(),
            'action'        => $action,
            'resource_type' => $resourceType,
            'resource_id'   => $resourceId,
            'changes'       => $changes,
            'ip_address'    => $request?->ip(),
            'user_agent'    => $request?->userAgent(),
            'metadata'      => $metadata,
        ]);
    }
}
```

---

## 八、Laravel 完整路由与控制器示例

### 8.1 API 路由

```php
// routes/api.php

use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware(['identify.tenant', 'tenant.rate.limit'])->group(function () {

    // Agent 对话接口
    Route::post('/agents/{agent}/chat', [AgentController::class, 'chat']);
    Route::post('/agents/{agent}/chat/stream', [AgentController::class, 'chatStream']);

    // Agent 管理接口
    Route::apiResource('agents', AgentController::class);

    // 会话管理
    Route::apiResource('conversations', ConversationController::class)->only(['index', 'show', 'destroy']);

    // 知识库管理
    Route::apiResource('knowledge-bases', KnowledgeBaseController::class);
    Route::post('/knowledge-bases/{kb}/documents', [KnowledgeBaseController::class, 'uploadDocument']);

    // 用量查询
    Route::get('/usage/current', [UsageController::class, 'current']);
    Route::get('/usage/history', [UsageController::class, 'history']);
    Route::get('/usage/bill/{month?}', [UsageController::class, 'bill']);

    // 租户配置
    Route::get('/tenant/config', [TenantController::class, 'config']);
    Route::put('/tenant/config', [TenantController::class, 'updateConfig']);
});
```

### 8.2 Agent 对话控制器

```php
// app/Http/Controllers/AgentController.php

namespace App\Http\Controllers;

use App\Models\Agent;
use App\Models\Conversation;
use App\Services\AgentExecutor;
use App\Services\QuotaGuard;
use App\Services\PromptGuard;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AgentController extends Controller
{
    public function __construct(
        private AgentExecutor $executor,
        private QuotaGuard $quotaGuard,
        private PromptGuard $promptGuard,
    ) {}

    /**
     * 与 Agent 对话（非流式）
     */
    public function chat(Request $request, Agent $agent)
    {
        // 1. 校验 Agent 属于当前租户（BelongsToTenant trait 已自动处理）
        if (!$agent->is_active) {
            return response()->json(['error' => 'Agent 已停用'], 404);
        }

        // 2. 配额检查
        $quotaCheck = $this->quotaGuard->handle(app('current_tenant'), fn() => true);
        if ($quotaCheck instanceof \Symfony\Component\HttpFoundation\Response) {
            return $quotaCheck; // 配额耗尽，返回错误
        }

        // 3. 参数验证
        $validated = $request->validate([
            'message'        => 'required|string|max:10000',
            'conversation_id' => 'nullable|integer|exists:conversations,id',
        ]);

        // 4. Prompt 清洗
        $userMessage = $this->promptGuard->sanitize($validated['message']);

        // 5. 获取或创建会话
        $conversation = $this->getOrCreateConversation($agent, $validated['conversation_id'] ?? null);

        // 6. 执行 Agent
        $result = $this->executor->execute($agent, $conversation, $userMessage);

        // 7. 审计日志
        AuditLog::log('agent.chat', 'Agent', $agent->id, [], [
            'conversation_id' => $conversation->id,
            'model' => $result['model'],
            'tokens' => $result['usage']['total_tokens'] ?? 0,
        ]);

        return response()->json([
            'data' => [
                'conversation_id' => $conversation->id,
                'message'         => $result['content'],
                'model'           => $result['model'],
                'usage'           => $result['usage'],
                'tool_calls'      => $result['tool_calls'] ?? [],
            ],
        ]);
    }

    /**
     * 与 Agent 对话（SSE 流式）
     */
    public function chatStream(Request $request, Agent $agent): StreamedResponse
    {
        if (!$agent->is_active) {
            return response()->json(['error' => 'Agent 已停用'], 404);
        }

        $validated = $request->validate([
            'message'        => 'required|string|max:10000',
            'conversation_id' => 'nullable|integer',
        ]);

        $userMessage = $this->promptGuard->sanitize($validated['message']);
        $conversation = $this->getOrCreateConversation($agent, $validated['conversation_id'] ?? null);

        return new StreamedResponse(function () use ($agent, $conversation, $userMessage) {
            $response = response()->stream(function () use ($agent, $conversation, $userMessage) {
                try {
                    $messages = $this->executor->buildMessages($agent, $conversation, $userMessage);
                    $config = $agent->getResolvedConfig();

                    $llm = app(\App\Services\LlmClient::class);

                    foreach ($llm->chatStream($messages, ['model' => $config['default_model']]) as $chunk) {
                        $content = $chunk['choices'][0]['delta']['content'] ?? '';
                        if ($content) {
                            echo "data: " . json_encode(['content' => $content]) . "\n\n";
                            ob_flush();
                            flush();
                        }
                    }

                    echo "data: " . json_encode(['done' => true]) . "\n\n";
                    ob_flush();
                    flush();
                } catch (\Throwable $e) {
                    echo "data: " . json_encode(['error' => $e->getMessage()]) . "\n\n";
                    ob_flush();
                    flush();
                }
            }, 200, [
                'Content-Type'  => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'Connection'    => 'keep-alive',
                'X-Accel-Buffering' => 'no', // Nginx 禁用缓冲
            ]);

            $response->send();
        });
    }

    private function getOrCreateConversation(Agent $agent, ?int $conversationId): Conversation
    {
        $tenant = app('current_tenant');

        if ($conversationId) {
            $conversation = Conversation::where('id', $conversationId)
                ->where('agent_id', $agent->id)
                ->first();

            if ($conversation) {
                return $conversation;
            }
        }

        return Conversation::create([
            'tenant_id'  => $tenant->id,
            'agent_id'   => $agent->id,
            'session_id' => \Illuminate\Support\Str::uuid(),
        ]);
    }
}
```

---

## 九、踩坑总结

在实际的多租户 AI Agent 平台开发和运维过程中，我们踩过不少坑。以下是最值得分享的经验教训：

### 9.1 全局作用域导致的 N+1 和性能问题

**问题描述**：`BelongsToTenant` 的全局作用域在关联查询中表现良好，但当需要在 Admin 面板中跨租户查询时，开发者容易忘记调用 `withoutGlobalScope()`，导致查询结果不完整或报错。

**解决方案**：

```php
// 创建一个 AdminScope trait，明确标识哪些查询需要绕过租户隔离
trait BypassesTenantScope
{
    public function scopeWithoutTenant($query)
    {
        return $query->withoutGlobalScope('tenant');
    }
}

// 在 Admin 控制器中使用
class AdminAgentController extends Controller
{
    public function index()
    {
        // 明确调用，代码意图清晰
        $agents = Agent::withoutTenant()->paginate(20);
    }
}
```

### 9.2 Redis 缓存 Key 命名冲突

**问题描述**：在开发初期，我们使用了 Redis 的默认缓存前缀，导致不同租户的 Rate Limit 计数器互相干扰。某个大客户的高频调用把小客户的配额也"消耗"掉了。

**解决方案**：

- 所有 Redis Key 必须包含 `tenant_id` 前缀
- 在 Laravel 的 `config/database.php` 中配置 `prefix` 为 `app_env:`
- 使用封装的 `TenantCache` 类而非直接调用 `Cache::` facade
- 定期扫描 Redis 中是否有缺少租户前缀的 Key

### 9.3 流式响应中的 Token 计量不准确

**问题描述**：使用 SSE 流式调用 LLM 时，部分供应商（如早期版本的 OpenAI）在最后一个 chunk 中返回 `usage` 字段，但有些供应商不返回。这导致 Token 计量不准确。

**解决方案**：

```php
// 方案1：使用 tiktoken 库在本地计算 Token 数
use Vansteen\Tiktoken\Tiktoken;

$encoder = new Tiktoken('cl100k_base'); // GPT-4 系列的编码器
$promptTokens = count($encoder->encode($promptText));
$completionTokens = count($encoder->encode($completionText));

// 方案2：在流结束后，异步向 LLM API 发送一个非流式请求来获取 usage
// 方案3：使用供应商提供的 Usage API 端点查询实际用量
```

### 9.4 向量数据库的跨租户搜索泄露

**问题描述**：在使用共享 Collection 模式时，由于 Metadata Filter 的实现疏忽，某个版本的代码在 RAG 检索时漏掉了 `tenant_id` 过滤条件，导致一个租户检索到了另一个租户的知识库数据。

**解决方案**：

- 在向量数据库服务的底层封装中**强制**附加租户过滤，而非依赖调用方
- 添加集成测试，验证不同租户的检索结果不交叉
- 监控向量检索结果的 score 分布，异常高分（接近 1.0）可能意味着跨租户命中

```php
// 在底层强制过滤，防御性编程
public function query(array $embedding, int $topK = 5, array $extraFilter = []): array
{
    $filter = array_merge([
        'tenant_id' => ['$eq' => app('current_tenant')->id], // 强制添加
    ], $extraFilter);

    return $this->doQuery($embedding, $topK, $filter);
}
```

### 9.5 并发请求导致的配额超卖

**问题描述**：当多个请求同时到达时，先检查配额再扣减的"先查后扣"模式会导致 Race Condition。理论上 100 个并发请求可能同时通过配额检查，导致实际消耗远超配额。

**解决方案**：

使用 Redis 的原子操作来避免竞态条件：

```php
public function checkAndDeductQuota(int $tenantId, int $tokensNeeded): bool
    {
    $quotaKey = "t:{$tenantId}:usage:tokens:monthly:" . now()->format('Y-m');
    $config = app('current_tenant')->getLlmConfig();
    $quota = $config['monthly_token_quota'];

    // 使用 Lua 脚本保证原子性：检查 + 扣减在一个操作中完成
    $luaScript = <<<LUA
        local current = redis.call('GET', KEYS[1])
        if not current then current = 0 else current = tonumber(current) end
        local newTotal = current + tonumber(ARGV[1])
        if newTotal > tonumber(ARGV[2]) then
            return -1
        end
        redis.call('INCRBY', KEYS[1], ARGV[1])
        return newTotal
    LUA;

    $result = Redis::eval($luaScript, 1, $quotaKey, $tokensNeeded, $quota);

    return $result !== -1;
}
```

### 9.6 租户配置变更的即时生效

**问题描述**：管理员在后台修改了租户的 LLM 配置（如切换默认模型），但由于缓存的存在，部分 Worker 进程仍然使用旧配置。

**解决方案**：

- 配置变更时主动清除相关缓存
- 使用事件广播机制通知所有 Worker 刷新配置
- 缓存 TTL 不宜过长（建议 5-15 分钟）

```php
// app/Observers/TenantObserver.php

class TenantObserver
{
    public function updated(Tenant $tenant): void
    {
        // 清除该租户的配置缓存
        Cache::forget("tenant_config:{$tenant->id}");

        // 广播配置变更事件（使用 Redis Pub/Sub）
        Redis::publish('tenant_config_changed', json_encode([
            'tenant_id' => $tenant->id,
            'timestamp' => now()->toIso8601String(),
        ]));
    }
}
```

### 9.7 成本估算的"甜蜜陷阱"

**问题描述**：在项目初期，团队对 LLM 调用成本的估算严重偏低。一个看似普通的客服 Agent，在高峰期每月产生了远超预期的 Token 消耗，导致供应商账单远超预算。

**解决方案**：

- **上线前进行压力测试**：使用真实或模拟的用户流量进行压测，统计 Token 消耗
- **设置硬上限**：每个套餐设置月度 Token 额度，超过即暂停服务
- **实现成本监控仪表板**：实时展示各租户的 Token 消耗和成本
- **推广缓存策略**：对相似查询的 LLM 响应进行语义缓存，减少重复调用
- **自动降级**：接近预算上限时自动切换到更便宜的模型

### 9.8 数据迁移的租户隔离

**问题描述**：在数据库迁移（Migration）过程中，如果需要对某个表进行批量数据更新，全局作用域不会被自动应用。一次误操作可能导致所有租户的数据被错误更新。

**解决方案**：

```php
// 数据迁移中必须明确指定租户范围
class FixAgentConfigMigration extends Migration
{
    public function up(): void
    {
        // ❌ 错误：可能影响所有租户
        // DB::table('agents')->update(['new_field' => 'default_value']);

        // ✅ 正确：逐租户处理
        $tenants = Tenant::all();
        foreach ($tenants as $tenant) {
            DB::table('agents')
                ->where('tenant_id', $tenant->id)
                ->update(['new_field' => $tenant->plan === 'enterprise' ? 'premium' : 'standard']);
        }
    }
}
```

---

## 十、生产环境部署建议

### 10.1 基础设施架构

```
                         ┌─────────────┐
                         │   CDN/WAF   │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │   Nginx     │
                         │  (反向代理)  │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
             ┌──────▼──┐ ┌─────▼───┐ ┌────▼────┐
             │ Laravel │ │ Laravel │ │ Laravel │  ← 多实例水平扩展
             │ App 1   │ │ App 2   │ │ App 3   │
             └────┬────┘ └────┬────┘ └────┬────┘
                  │           │           │
          ┌───────┼───────────┼───────────┼───────┐
          │       │           │           │       │
    ┌─────▼──┐ ┌──▼───┐ ┌────▼──┐ ┌─────▼──┐ ┌──▼──────┐
    │ MySQL  │ │Redis │ │ Qdrant│ │ 队列    │ │ 对象存储 │
    │(主从)  │ │(集群)│ │       │ │ Worker  │ │ (S3/OSS)│
    └────────┘ └──────┘ └───────┘ └────────┘ └─────────┘
```

### 10.2 关键监控指标

| 指标 | 采集方式 | 告警阈值 |
|------|----------|---------|
| LLM API 延迟 (P50/P95/P99) | 应用埋点 | P95 > 5s |
| LLM API 错误率 | 日志统计 | > 1% |
| 租户 Token 消耗速率 | Redis 计数器 | 接近配额 80% |
| 队列积压数量 | Horizon 监控 | > 1000 |
| 数据库连接数 | MySQL 指标 | > 80% 连接池 |
| Redis 内存使用 | Redis INFO | > 80% |
| 向量数据库查询延迟 | 应用埋点 | P95 > 500ms |

### 10.3 灾备与降级策略

1. **LLM 供应商故障**：自动 Failover 到备用供应商（已在 LlmClient 中实现）
2. **向量数据库故障**：降级为关键词搜索，或返回"知识库暂时不可用"
3. **Redis 故障**：Rate Limit 降级为数据库计数（性能降低但可用）
4. **队列积压**：优先处理付费租户的请求，免费租户降级为异步通知
5. **数据库压力**：读写分离 + 定期归档历史用量记录

---

## 十一、总结

构建一个面向 B2B 客户的多租户 AI Agent SaaS 平台，远比搭建一个简单的 ChatGPT 套壳应用复杂得多。本文从架构设计到工程实现，系统性地拆解了其中的核心挑战：

1. **租户识别与隔离**：通过 API Key + 中间件 + Eloquent 全局作用域，实现了透明的、低侵入的数据隔离
2. **多层数据隔离**：从数据库、缓存到向量数据库，每一层都设计了租户感知的隔离机制
3. **智能 LLM 路由**：支持按租户配置模型、供应商、端点，内置 Failover 和自动降级
4. **精确的用量计量**：同步计数 + 异步持久化的双轨模式，在性能和准确性之间取得平衡
5. **灵活的 Rate Limiting**：多维度限流 + Lua 脚本原子操作，避免配额超卖
6. **安全性纵深防御**：从 API Key 安全、Prompt 注入防护到审计日志，构建多层次的安全防线

Laravel 作为一个成熟的 PHP 框架，提供了优雅的 ORM、灵活的中间件、强大的队列系统和丰富的生态系统，非常适合用来构建这类中等复杂度的 SaaS 后端。结合 Redis、向量数据库和 LLM API，我们可以在 Laravel 上构建出一个功能完备、安全可靠、成本可控的多租户 AI Agent 平台。

最后，提醒读者注意以下几点：

- **从第一天就设计多租户架构**，不要先做单租户再改造，成本会非常高
- **先做共享表模式**，等到有真正的大型企业客户需要时再迁移到独立数据库
- **计量和限流比你想象的重要 10 倍**，一个失控的免费用户可能在一夜之间消耗掉你一个月的预算
- **安全不是事后补充的功能**，全局作用域、Prompt 清洗、审计日志必须从第一天就写入代码
- **持续监控成本**，LLM API 的价格虽然在下降，但用量增长的速度往往更快

希望这篇文章能帮助你在构建多租户 AI Agent 平台时少走弯路，如果你在实践中遇到新的问题，欢迎在评论区交流讨论。

## 相关阅读

- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/post/ai-agent-sql/)
- [Coze 实战：字节跳动 AI Bot 平台与插件生态集成](/post/coze-ai-bot/)
- [Web3 集成实战：ethers.js/web3.php 钱包连接与智能合约交互](/post/web3-ethersjs-web3php-wallet-smart-contract/)
