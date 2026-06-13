---

title: AI Gateway 实战：统一 LLM 调用层——LiteLLM/Kong AI Gateway 的路由、限流与可观测性
keywords: [AI Gateway, LLM, LiteLLM, Kong AI Gateway, 统一, 调用层, 的路由, 限流与可观测性]
date: 2026-06-02 00:00:00
tags:
- ai-gateway
- LiteLLM
- Kong
- LLM
- 可观测性
- 限流
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深入对比 LiteLLM Proxy 与 Kong AI Gateway 两大主流 AI Gateway 方案，解决 LLM 生产环境中 API Key 散落、成本不可见、供应商锁定、限流困难等核心痛点。涵盖 100+ Provider 统一接入、延迟/成本/错误率多维路由策略、Token 级预算管理、语义缓存原理与配置、Langfuse 与 OpenTelemetry 可观测性集成、Prompt 注入防护与 PII 脱敏，以及高可用部署架构与 Token 计数不准、流式响应超时等生产踩坑实战。
---




# AI Gateway 实战：统一 LLM 调用层——LiteLLM/Kong AI Gateway 的路由、限流与可观测性

## 前言

当你的团队开始在生产环境中大规模使用 LLM 时，一个绕不开的问题浮出水面：**如何管理散落在各处的 LLM 调用？** 每个服务各自对接 OpenAI、Claude、Gemini，各自处理 API Key、重试逻辑、Token 计数和成本追踪——这种"点对点"模式在 3 个服务、1 个模型时尚可接受，但当服务数量增长到 10+、模型数量增长到 5+ 时，维护成本将呈指数级爆炸。

**AI Gateway** 就是这个问题的答案。它在 LLM Provider 和你的应用之间插入一个统一的代理层，提供路由、限流、缓存、可观测性和安全防护。本文将深入对比两大主流方案：**LiteLLM Proxy** 和 **Kong AI Gateway**，并展示如何在生产环境中落地。

## 一、AI Gateway 的定义与价值

### 1.1 为什么需要统一 LLM 调用层

在没有 AI Gateway 的架构中，每个业务服务直接调用 LLM Provider：

```
服务A → OpenAI API
服务B → OpenAI API + Claude API
服务C → Gemini API + OpenAI API
服务D → Azure OpenAI + 自建模型
```

这种架构带来以下问题：

1. **API Key 泄露风险**：每个服务都需要配置 API Key，密钥散布在多个配置文件中
2. **成本不可见**：无法统一追踪各服务、各模型的 Token 消耗和费用
3. **供应商锁定**：切换模型需要修改每个服务的代码
4. **限流困难**：各 Provider 有自己的速率限制，但缺乏全局视角
5. **重试与容错缺失**：每个服务自行实现重试逻辑，质量参差不齐
6. **Prompt 管理混乱**：Prompt 模板散落在各处，无法统一版本管理

### 1.2 AI Gateway 的核心能力

一个成熟的 AI Gateway 应该提供：

- **统一 API 接口**：应用只需对接一个端点，Gateway 负责转发到不同 Provider
- **智能路由**：按模型类型、成本、延迟、可用性动态选择最优 Provider
- **限流与预算管理**：Token 级限流、每用户/每团队预算控制
- **语义缓存**：相似请求命中缓存，减少重复调用
- **可观测性**：请求追踪、Token 计数、成本分析、延迟监控
- **安全防护**：Prompt 注入检测、PII 过滤、内容审核

## 二、LiteLLM Proxy 架构详解

### 2.1 什么是 LiteLLM

LiteLLM 是一个开源的 Python 库和代理服务器，支持 100+ 种 LLM Provider（OpenAI、Anthropic、Google、Azure、AWS Bedrock、Hugging Face 等），提供统一的 OpenAI 兼容 API。

### 2.2 快速部署

```yaml
# docker-compose.yml
version: '3.8'
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    volumes:
      - ./config.yaml:/app/config.yaml
    command: --config /app/config.yaml --port 4000
    environment:
      - OPENAI_API_KEY=sk-xxx
      - ANTHROPIC_API_KEY=sk-ant-xxx
      - GEMINI_API_KEY=xxx

  litellm-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: litellm
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: securepassword
    volumes:
      - litellm-data:/var/lib/postgresql/data

volumes:
  litellm-data:
```

### 2.3 配置文件详解

```yaml
# config.yaml
model_list:
  # OpenAI GPT-4o
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
      rpm: 60        # 每分钟请求数限制
      tpm: 100000    # 每分钟 Token 数限制

  # Anthropic Claude (作为 GPT-4o 的 Fallback)
  - model_name: gpt-4o
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  # Azure OpenAI (企业合规场景)
  - model_name: gpt-4o-enterprise
    litellm_params:
      model: azure/gpt-4o
      api_base: https://myorg.openai.azure.com/
      api_key: os.environ/AZURE_OPENAI_KEY
      api_version: "2024-08-01-preview"

  # 自建模型 (vLLM)
  - model_name: llama-3-70b
    litellm_params:
      model: openai/meta-llama/Llama-3-70b-chat-hf
      api_base: http://vllm-server:8000/v1
      api_key: "dummy"

router_settings:
  routing_strategy: latency-based-routing  # 基于延迟的路由
  num_retries: 3
  timeout: 30
  fallbacks:
    - gpt-4o: [anthropic/claude-sonnet-4-20250514]
  allowed_fails: 2
  cooldown_time: 30

general_settings:
  master_key: sk-master-xxx      # 管理员密钥
  database_url: postgresql://litellm:securepassword@litellm-db:5432/litellm
  store_model_in_db: true
  proxy_budget_rescheduler_min_time: 60
  proxy_budget_rescheduler_max_time: 120

litellm_settings:
  set_verbose: false
  num_retries: 3
  request_timeout: 30
  # 语义缓存
  cache: true
  cache_params:
    type: redis
    host: redis
    port: 6379
    ttl: 3600
    similarity_threshold: 0.85
```

### 2.4 多模型路由策略

LiteLLM 支持多种路由策略：

**1. 延迟优先路由（Latency-Based Routing）**
自动选择历史延迟最低的 Provider。适合对响应速度敏感的场景。

**2. 成本优先路由（Cost-Based Routing）**
自动选择每 Token 成本最低的 Provider。适合批量处理和非实时场景。

```yaml
router_settings:
  routing_strategy: cost-based-routing
  model_group_budgets:
    gpt-4o: 100      # 每月预算 $100
    embedding: 50     # Embedding 模型每月 $50
```

**3. 最低错误率路由**
自动将流量导向错误率最低的实例，适合高可用场景。

### 2.5 预算管理

LiteLLM 支持细粒度的预算控制：

```bash
# 创建 API Key 并设置预算
curl -X POST http://localhost:4000/key/generate \
  -H "Authorization: Bearer sk-master-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "max_budget": 50,
    "budget_duration": "30d",
    "max_parallel_requests": 10,
    "metadata": {"team": "backend", "project": "recommendation"},
    "models": ["gpt-4o", "claude-sonnet-4-20250514"]
  }'
```

返回的 API Key 绑定了 $50/月的预算限制和最大 10 并发请求。当预算耗尽时，该 Key 的所有请求会被自动拒绝。

## 三、Kong AI Gateway 插件体系

### 3.1 为什么选择 Kong

Kong 是业界最成熟的 API Gateway 之一，拥有庞大的插件生态。Kong 3.6+ 引入了 AI Gateway 专用插件，将 LLM 调用管理纳入已有的 API 管理体系——如果你已经在使用 Kong 作为 API Gateway，无需引入额外组件。

### 3.2 核心 AI 插件

**AI Proxy 插件**：将 Kong 的路由能力扩展到 LLM Provider

```yaml
# Kong AI Proxy 配置
_format_version: "3.0"
services:
  - name: openai-service
    url: http://localhost:32000
    routes:
      - name: openai-route
        paths: ["/v1/chat/completions"]
    plugins:
      - name: ai-proxy
        config:
          route_type: "llm/v1/chat"
          auth:
            header_name: "Authorization"
            header_value: "Bearer ${OPENAI_API_KEY}"
          model:
            provider: "openai"
            name: "gpt-4o"
            options:
              max_tokens: 4096
              temperature: 0.7
          logging:
            log_statistics: true
            log_payloads: false
```

**AI Prompt Guard 插件**：Prompt 注入防护

```yaml
plugins:
  - name: ai-prompt-guard
    config:
      allow_patterns:
        - "^你是一个.*助手"
        - "^You are a helpful assistant"
      deny_patterns:
        - "ignore previous instructions"
        - "忽略之前的指令"
        - "system prompt"
        - "reveal your.*instructions"
      max_request_body_size: 8192
```

**AI Rate Limiting Advanced 插件**：Token 级限流

```yaml
plugins:
  - name: rate-limiting-advanced
    config:
      limit:
        - 100000    # 每分钟 100K Token
      window_size:
        - 60
      identifier: consumer
      sync_rate: 10
      strategy: "redis"
      redis:
        host: redis
        port: 6379
```

**AI Semantic Cache 插件**：语义缓存

```yaml
plugins:
  - name: ai-semantic-cache
    config:
      embeddings:
        provider: "openai"
        model: "text-embedding-3-small"
      vector_database:
        type: "redis"
        host: "redis-stack"
        port: 6379
        index: "llm-cache"
      cache_ttl: 3600
      similarity_threshold: 0.90
```

### 3.3 AI 语义缓存的工作原理

语义缓存与传统缓存的关键区别在于：它不是精确匹配请求内容，而是通过向量化计算语义相似度。当用户问"法国的首都是哪里？"和"法国首都是什么城市？"时，语义缓存可以识别这两个问题指向同一个答案。

流程：
1. 请求到达 → 生成 Embedding 向量
2. 在向量数据库中搜索相似向量（余弦相似度 > 阈值）
3. 命中 → 直接返回缓存结果（0 Token 消耗）
4. 未命中 → 调用 LLM → 将结果存入向量数据库

## 四、路由策略设计

### 4.1 按模型类型路由

不同任务使用不同模型，这是最基础的路由策略：

```yaml
# 路由设计示例
routes:
  # 代码生成 → Claude（代码能力强）
  - path: /v1/code/*
    model: claude-sonnet-4-20250514
    
  # 文本摘要 → GPT-4o-mini（成本低）
  - path: /v1/summarize/*
    model: gpt-4o-mini
    
  # 数据分析 → GPT-4o（推理能力强）
  - path: /v1/analyze/*
    model: gpt-4o
    
  # Embedding → text-embedding-3-small
  - path: /v1/embeddings/*
    model: text-embedding-3-small
```

### 4.2 按成本路由

在 LiteLLM 中实现成本感知路由：

```python
# LiteLLM 路由器自定义策略
from litellm import Router

router = Router(
    model_list=model_list,
    routing_strategy="usage-based-routing",
    # 成本低的模型优先
    model_group_map={
        "chat": [
            {"model": "gpt-4o-mini", "priority": 1},     # 最便宜
            {"model": "gpt-4o", "priority": 2},           # 中等
            {"model": "claude-opus-4-20250514", "priority": 3},  # 最贵
        ]
    }
)

# 根据请求复杂度动态选择模型
async def route_by_complexity(messages):
    # 简单查询用便宜模型
    if len(messages) <= 3 and total_tokens(messages) < 500:
        return await router.completion(model="chat", messages=messages, priority=1)
    # 复杂推理用强模型
    else:
        return await router.completion(model="chat", messages=messages, priority=3)
```

### 4.3 按用户/团队路由

企业场景中，不同团队可能有权访问不同模型：

```yaml
# LiteLLM 团队配置
teams:
  - team_name: "premium-team"
    models: ["gpt-4o", "claude-opus-4-20250514"]
    max_budget: 500
    budget_duration: "30d"
    
  - team_name: "standard-team"
    models: ["gpt-4o-mini", "claude-sonnet-4-20250514"]
    max_budget: 100
    budget_duration: "30d"
    
  - team_name: "free-tier"
    models: ["gpt-4o-mini"]
    max_budget: 10
    budget_duration: "30d"
    max_parallel_requests: 2
```

## 五、可观测性

### 5.1 Langfuse 集成

Langfuse 是专为 LLM 应用设计的可观测性平台，与 LiteLLM 深度集成：

```yaml
# config.yaml 中启用 Langfuse
litellm_settings:
  success_callback: ["langfuse"]
  failure_callback: ["langfuse"]
  langfuse_public_key: "pk-xxx"
  langfuse_secret_key: "sk-xxx"
  langfuse_host: "https://cloud.langfuse.com"
```

Langfuse 提供的可观测能力：
- **Trace（追踪）**：完整记录一个请求从用户输入到 LLM 响应的全过程
- **Span（跨度）**：分解每个步骤的耗时（Embedding → 检索 → LLM 调用 → 后处理）
- **Generation（生成）**：记录每次 LLM 调用的输入/输出、Token 数、延迟、成本
- **Evaluation（评估）**：对 LLM 输出质量进行自动或人工评分

### 5.2 OpenTelemetry 集成

对于已有 Prometheus/Grafana 监控栈的团队，可以通过 OpenTelemetry 桥接：

```yaml
# LiteLLM OpenTelemetry 配置
litellm_settings:
  success_callback: ["otel"]
  failure_callback: ["otel"]
  
environment_variables:
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4317"
  OTEL_SERVICE_NAME: "litellm-proxy"
```

关键指标：
- `litellm_request_total_latency`：请求总延迟
- `litellm_llm_api_latency`：LLM API 调用延迟
- `litellm_tokens_total`：Token 总消耗
- `litellm_cost_total`：总成本

### 5.3 成本分析 Dashboard

在 Grafana 中构建 LLM 成本分析面板：

```sql
-- 按模型统计每日成本
SELECT 
    model,
    DATE(created_at) as date,
    SUM(prompt_tokens) as total_prompt_tokens,
    SUM(completion_tokens) as total_completion_tokens,
    SUM(cost) as total_cost,
    COUNT(*) as request_count,
    AVG(latency) as avg_latency
FROM llm_request_logs
WHERE created_at >= NOW() - INTERVAL 30 DAY
GROUP BY model, DATE(created_at)
ORDER BY date DESC, total_cost DESC;

-- 按团队统计月度预算使用率
SELECT 
    team_name,
    budget_limit,
    SUM(cost) as used_budget,
    ROUND(SUM(cost) / budget_limit * 100, 2) as usage_percentage
FROM llm_request_logs
JOIN teams USING (team_id)
WHERE created_at >= DATE_TRUNC('month', NOW())
GROUP BY team_name, budget_limit
ORDER BY usage_percentage DESC;
```

## 六、与 AWS Bedrock / Azure OpenAI Service 的对比

| 特性 | LiteLLM Proxy | Kong AI Gateway | AWS Bedrock | Azure OpenAI |
|------|--------------|-----------------|-------------|--------------|
| 多 Provider 支持 | 100+ | 通过插件扩展 | 仅 AWS 模型 | 仅 OpenAI 模型 |
| 自托管 | ✅ | ✅ | ❌ 全托管 | ❌ 全托管 |
| 语义缓存 | ✅ | ✅ | ❌ | ❌ |
| Token 级限流 | ✅ | ✅ | ✅（配额制） | ✅（配额制） |
| 可观测性 | Langfuse/OTel | Kong 插件 | CloudWatch | Azure Monitor |
| Prompt 注入防护 | 需自定义 | ✅ AI Prompt Guard | ✅ Guardrails | ✅ Content Filter |
| 运维复杂度 | 低 | 中 | 低 | 低 |
| 成本 | 开源免费 | 开源 + 企业版 | 按调用付费 | 按调用付费 |

**选型建议**：
- **小团队快速起步** → LiteLLM Proxy（部署简单，功能全面）
- **已有 Kong 基础设施** → Kong AI Gateway（复用已有能力）
- **纯 AWS 生态** → AWS Bedrock（免运维，但供应商锁定）
- **纯 Azure 生态 + 企业合规** → Azure OpenAI Service（SLA 保障）

## 七、安全最佳实践

### 7.1 Prompt 注入防护

```yaml
# Kong AI Prompt Guard 高级配置
plugins:
  - name: ai-prompt-guard
    config:
      allow_patterns:
        - "^系统指令：.*"
      deny_patterns:
        # 经典 Prompt 注入模式
        - "(?i)ignore (all |previous |above )?instructions"
        - "(?i)you are now"
        - "(?i)new instructions"
        - "(?i)forget (everything|all)"
        - "(?i)reveal (your|the) (system|prompt)"
        - "(?i)act as (if|a)"
        - "(?i)do anything now"
        - "(?i)jailbreak"
      redact_patterns:
        # PII 自动脱敏
        - "\\b\\d{3}-\\d{2}-\\d{4}\\b"   # SSN
        - "\\b\\d{16}\\b"                  # 信用卡号
        - "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"  # 邮箱
```

### 7.2 密钥轮换

```bash
# LiteLLM 支持动态密钥轮换
curl -X POST http://localhost:4000/key/update \
  -H "Authorization: Bearer sk-master-xxx" \
  -d '{
    "key": "sk-user-xxx",
    "models": ["gpt-4o"],
    "max_budget": 100
  }'
```

## 八、生产环境部署与踩坑记录

### 8.1 高可用部署

```
                    ┌─────────────┐
                    │   Cloud LB  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐┌────┴─────┐┌─────┴─────┐
        │ LiteLLM-1 ││LiteLLM-2 ││LiteLLM-3  │
        └─────┬─────┘└────┬─────┘└─────┬─────┘
              │           │            │
              └─────┬─────┴────────────┘
                    │
              ┌─────┴─────┐
              │  Redis     │  ← 共享缓存 + 限流状态
              │  (集群)    │
              └───────────┘
```

### 8.2 常见踩坑

**踩坑 1：Token 计数不准**
不同 Provider 对 Token 的计算方式不同（cl100k_base vs o200k_base）。解决方案：在 Gateway 层统一使用 `tiktoken` 库进行计数。

**踩坑 2：语义缓存误命中**
相似度阈值设置过低导致不相关的请求被缓存命中。建议阈值设为 0.85-0.92，并在上线前进行充分测试。

**踩坑 3：限流导致 429 错误**
当多个服务共享同一个 API Key 时，容易触发 Provider 的速率限制。解决方案：在 Gateway 层设置低于 Provider 限制的阈值，留出缓冲。

**踩坑 4：流式响应超时**
SSE（Server-Sent Events）流式响应在经过 Gateway 时可能因为中间代理超时。解决方案：调整 Gateway 和负载均衡器的超时配置，建议至少 120 秒。

## 九、总结

AI Gateway 是 LLM 应用从"玩具"走向"生产"的关键基础设施。它解决的核心问题是**可观测性、可控性和可替换性**——当你能清楚看到每个模型的 Token 消耗和成本，当你能精确控制每个用户的调用频率和预算，当你能在 5 分钟内切换底层 LLM Provider 时，你的 AI 应用才真正具备了生产级的韧性。

LiteLLM Proxy 和 Kong AI Gateway 各有侧重：前者更轻量、更适合纯 LLM 场景；后者更全面、更适合已有 API Gateway 基础设施的团队。无论选择哪个，核心原则不变：**不要让业务代码直接依赖任何 LLM Provider 的 API**——所有调用都经过 Gateway，这是你在 AI 时代最重要的架构决策之一。

## 相关阅读

- [AI Agent 评估实战：LLM-as-Judge、Benchmark 设计与回归测试——如何量化 Agent 质量](/categories/架构/AI-Agent-评估实战-LLM-as-Judge-Benchmark-设计与回归测试/)
- [Structured Output 实战：让 LLM 返回结构化 JSON——Pydantic/Zod schema 驱动的可靠输出](/categories/架构/Structured-Output-实战/)
- [三大框架模型路由对比：Hermes ProviderProfile vs OpenClaw Fallback Chain vs OpenHuman Hint Router](/categories/架构/三大框架模型路由对比-Hermes-ProviderProfile-vs-OpenClaw-Fallback-Chain-vs-OpenHuman-Hint-Router/)
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
